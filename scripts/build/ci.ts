/**
 * CI integration: collapsible log groups, environment dump, Buildkite
 * annotations on build failure.
 *
 * Thin layer over `scripts/utils.mjs` — the same helpers the CMake build
 * uses. We import rather than reimplement so CI logs look identical and
 * annotation regex stays in one place.
 */

import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateOrderFile } from "../orderfile/generate.ts";
// @ts-ignore — utils.mjs has JSDoc types but no .d.ts
import * as utils from "../utils.mjs";
import { bunExeName, shouldStrip, type BunOutput } from "./bun.ts";
import type { Config } from "./config.ts";
import { BuildError } from "./error.ts";
import { crossFeaturesJson } from "./features-json.ts";
import { orderFilePath, usesOrderFile } from "./flags.ts";

/** True if running under any CI (env: CI, BUILDKITE, or GITHUB_ACTIONS). */
export const isCI: boolean = utils.isCI;

/** True if running under Buildkite specifically. */
export const isBuildkite: boolean = utils.isBuildkite;

/** True if running under GitHub Actions specifically. */
export const isGithubAction: boolean = utils.isGithubAction;

/**
 * Print machine/environment/repository info in collapsible groups.
 * Call at the top of a CI run so you can diagnose without SSH access.
 */
export const printEnvironment: () => void = utils.printEnvironment;

/**
 * Start a collapsible log group. Buildkite: `--- Title`. GitHub: `::group::`.
 * If `fn` is given, runs it and closes the group (handles async).
 */
export const startGroup: (title: string, fn?: () => unknown) => unknown = utils.startGroup;

/** Close the most recent group opened with `startGroup`. */
export const endGroup: () => void = utils.endGroup;

interface SpawnAnnotatedOptions {
  /** Working directory for the subprocess. */
  cwd?: string;
  /** Label for duration printing (defaults to basename of command). */
  label?: string;
  /** Environment variables for the subprocess. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawn a subprocess with CI output handling. Only call this in CI —
 * locally use plain spawnSync for zero-overhead no-ops.
 *
 * Tees stdout/stderr to the terminal AND a buffer. On non-zero exit,
 * parses the buffer for compiler errors (rustc/clang/cmake) and posts each
 * as a Buildkite annotation. If nothing parseable is found, posts a generic
 * "build failed" annotation with the full output. Prints duration at end.
 *
 * Exits the process with the subprocess's exit code on failure.
 * Returns only on success.
 */
export async function spawnWithAnnotations(
  command: string,
  args: string[],
  opts: SpawnAnnotatedOptions = {},
): Promise<void> {
  const label = opts.label ?? command;

  const child = nodeSpawn(command, args, {
    stdio: "pipe",
    cwd: opts.cwd,
    env: opts.env,
  });

  // Kill child on parent signals so ninja doesn't linger.
  let killedManually = false;
  const onKill = () => {
    if (!child.killed) {
      killedManually = true;
      child.kill();
    }
  };
  if (process.platform !== "win32") {
    process.once("beforeExit", onKill);
    process.once("SIGINT", onKill);
    process.once("SIGTERM", onKill);
  }
  const clearOnKill = () => {
    process.off("beforeExit", onKill);
    process.off("SIGINT", onKill);
    process.off("SIGTERM", onKill);
  };

  const start = Date.now();
  let buffer = "";

  // Tee: write to terminal live AND buffer for later annotation parsing.
  const stdout = new Promise<void>(resolve => {
    child.stdout!.on("end", resolve);
    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      process.stdout.write(chunk);
    });
  });
  const stderr = new Promise<void>(resolve => {
    child.stderr!.on("end", resolve);
    child.stderr!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      process.stderr.write(chunk);
    });
  });

  const { exitCode, signalCode, error } = await new Promise<{
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    error?: Error;
  }>(resolve => {
    child.on("error", error => {
      clearOnKill();
      resolve({ exitCode: null, signalCode: null, error });
    });
    child.on("exit", (exitCode, signalCode) => {
      clearOnKill();
      resolve({ exitCode, signalCode });
    });
  });

  await Promise.all([stdout, stderr]);

  const elapsed = Date.now() - start;
  const elapsedStr =
    elapsed > 60000 ? `${(elapsed / 60000).toFixed(2)} minutes` : `${(elapsed / 1000).toFixed(2)} seconds`;
  console.log(`${label} took ${elapsedStr}`);

  if (error) {
    console.error(`Failed to spawn ${command}: ${error.message}`);
    process.exit(127);
  }

  if (exitCode === 0) return;

  // ─── Failure: report annotations to Buildkite ───
  if (isBuildkite) {
    let annotated = false;
    try {
      // In piped mode, ninja prints ALL command output including successful
      // jobs — so the buffer contains dep cmake deprecation warnings from
      // vendored CMakeLists.txt we don't control. Keep dep errors (broken
      // compiler, bad flags) since those are actionable; drop dep warnings.
      const annotatable = buffer
        .split("\n")
        .filter(line => !/^\[[\w-]+\]\s+CMake (Deprecation )?Warning/i.test(line.replace(/\x1b\[[0-9;]*m/g, "")))
        .join("\n");
      const { annotations } = utils.parseAnnotations(annotatable);
      for (const ann of annotations) {
        utils.reportAnnotationToBuildKite({
          priority: 10,
          label: ann.title || ann.filename,
          content: utils.formatAnnotationToHtml(ann),
        });
        annotated = true;
      }
    } catch (err) {
      console.error("Failed to parse annotations:", err);
    }

    // Nothing matched the compiler-error regexes → post a generic annotation
    // with the full buffered output so there's still a PR-visible signal.
    if (!annotated) {
      const content = utils.formatAnnotationToHtml({
        filename: relative(process.cwd(), fileURLToPath(import.meta.url)),
        title: "build failed",
        content: buffer,
        source: "build",
        level: "error",
      });
      utils.reportAnnotationToBuildKite({
        priority: 10,
        label: "build failed",
        content,
      });
    }
  }

  if (signalCode) {
    if (!killedManually) console.error(`Command killed: ${signalCode}`);
  } else {
    console.error(`Command exited: code ${exitCode}`);
  }

  utils.markBuildkiteStepReported();
  process.exit(exitCode ?? 1);
}

// ───────────────────────────────────────────────────────────────────────────
// Buildkite artifacts — split-build upload/download
//
// CI splits builds per-platform into three parallel steps:
//   build-cpp  → libbun.a + all dep libs (this node uploads)
//   build-rust → libbun_rust.a (this node uploads)
//   build-bun  → downloads both, links (this node downloads first)
//
// Paths are uploaded RELATIVE TO buildDir. buildkite-agent recreates the
// directory structure on download. The link-only ninja graph expects files
// at the SAME relative paths cpp-only produced them at — computeDepLibs()
// and emitNestedCmake() share the same path formula.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Upload build artifacts after a successful cpp-only or rust-only build.
 * Runs `buildkite-agent artifact upload` with paths relative to buildDir.
 *
 * Large archives (libbun-*.a, >1GB) are gzipped — buildkite artifact
 * storage is fine but upload/download is faster. link-only gunzips.
 *
 * ORDER MATTERS: upload dep libs FIRST (some live in cache/ — WebKit
 * prebuilt), THEN rm cache + gzip + upload the archive. If cache is
 * deleted first, WebKit lib upload fails with "file not found". The
 * old cmake had this ordering implicitly — each dep's build uploaded
 * its libs immediately; rm only ran when the archive target fired.
 */
export function uploadArtifacts(cfg: Config, output: BunOutput): void {
  if (!isBuildkite) {
    console.log("Not in Buildkite — skipping artifact upload");
    return;
  }

  if (cfg.mode === "rust-only") {
    // Relative to buildDir so link-only's `artifact download '*' .` recreates
    // the rust-target/<triple>/<profile>/ layout that `rustLibPath(cfg)`
    // expects. gzip on posix (release staticlib is ~200MB of mostly bitcode
    // when LTO is on); .lib on Windows is uploaded raw — same convention as
    // the cpp archive below.
    const paths = output.rustObjects.map(obj => relative(cfg.buildDir, obj));
    console.log(`Uploading ${paths.length} rust artifact(s)...`);
    if (cfg.windows) {
      upload(paths, cfg.buildDir);
    } else {
      for (const p of paths) run(["gzip", "-1", "-k", p], cfg.buildDir);
      upload(
        paths.map(p => `${p}.gz`),
        cfg.buildDir,
      );
    }
    return;
  }

  if (cfg.mode !== "cpp-only") {
    // full/link-only don't upload split artifacts.
    return;
  }

  // ─── Phase 1: upload dep libs (before we rm anything) ───
  // In Buildkite, ninja already uploaded these via the bk_upload edge in
  // bun.ts (overlapped with the cxx compile). The stamp is the witness; if
  // it's missing (agent unavailable mid-build, or running cpp-only outside
  // a real BK job), fall back to uploading here so link-only still gets them.
  if (existsSync(resolve(cfg.buildDir, ".dep-libs-uploaded"))) {
    console.log("Dep libs already uploaded during build");
  } else {
    const depPaths: string[] = [];
    for (const dep of output.deps) {
      for (const lib of dep.libs) {
        depPaths.push(relative(cfg.buildDir, lib));
      }
    }
    console.log(`Uploading ${depPaths.length} dep libs...`);
    upload(depPaths, cfg.buildDir);
  }

  // ─── Phase 2: free disk, gzip (posix only), upload archive ───
  // CI agents are disk-constrained. Free what we no longer need: codegen/
  // (sources already compiled into the archive), obj/ (.o files archived),
  // cache/ (WebKit prebuilt — libs uploaded in phase 1, rest is headers
  // + tarball we won't touch again).
  if (output.archive !== undefined) {
    const archiveName = basename(output.archive);

    console.log("Cleaning intermediate files to free disk...");
    rmSync(cfg.codegenDir, { recursive: true, force: true });
    rmSync(resolve(cfg.buildDir, "obj"), { recursive: true, force: true });
    rmSync(cfg.cacheDir, { recursive: true, force: true });

    // gzip: posix only (matches cmake — only libbun-*.a are gzipped,
    // Windows .lib archives uploaded uncompressed). gzip isn't a
    // standard Windows tool anyway; the .lib is smaller (PDB is separate).
    // downloadArtifacts() only gunzips .gz files it finds, so Windows
    // archives pass through unchanged.
    if (cfg.windows) {
      console.log("Uploading archive (Windows: no gzip)...");
      upload([archiveName], cfg.buildDir);
    } else {
      console.log(`Compressing ${archiveName}...`);
      run(["gzip", "-1", archiveName], cfg.buildDir);
      console.log("Uploading archive...");
      upload([`${archiveName}.gz`], cfg.buildDir);
    }
  }
}

/**
 * Upload via buildkite-agent. Semicolon-joined single arg — the agent
 * splits on ";" by default (--delimiter flag, Value: ";"). Second
 * positional arg is interpreted as upload DESTINATION, not another path.
 */
function upload(paths: string[], cwd: string): void {
  if (paths.length === 0) return;
  run(["buildkite-agent", "artifact", "upload", paths.join(";")], cwd);
}

// ───────────────────────────────────────────────────────────────────────────
// Link-only post-link: features.json + packaging + upload
//
// The zip contract (matching cmake's BuildBun.cmake packaging — test steps
// download these by exact name):
//
//   ${bunTriplet}-profile.zip   (plain release)
//     └── ${bunTriplet}-profile/
//           ├── bun-profile[.exe]
//           ├── features.json
//           ├── bun-profile.linker-map   (linux/mac non-asan)
//           ├── bun-profile.pdb          (windows)
//           └── bun-profile.dSYM         (mac)
//
//   ${bunTriplet}.zip           (stripped, plain release only)
//     └── ${bunTriplet}/
//           └── bun[.exe]
//
//   ${bunTriplet}-asan.zip      (asan — single zip, no strip)
//     └── ${bunTriplet}-asan/
//           ├── bun-asan
//           └── features.json
//
// bunTriplet = bun-${os}-${arch}[-musl][-baseline]
//
// Test steps (runner.node.mjs) download '**' from build-bun and pick any
// bun*.zip; baseline-verification step downloads ${triplet}.zip specifically
// and expects ${triplet}/bun inside.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Base triplet (bun-os-arch[-musl][-baseline]). Variant suffix (-profile,
 * -asan) is added by the caller. Matches ci.mjs getTargetTriplet() and
 * cmake's bunTriplet — any drift breaks test-step downloads.
 */
export function computeBunTriplet(cfg: Config): string {
  let t = `bun-${cfg.os}-${cfg.arch}`;
  if (cfg.abi === "musl") t += "-musl";
  if (cfg.abi === "android") t += "-android";
  if (cfg.baseline) t += "-baseline";
  return t;
}

/**
 * Post-link packaging and upload for link-only mode. Runs AFTER ninja
 * succeeds — at that point bun-profile (and stripped bun) exist.
 *
 * Generates features.json, packages into zips,
 * uploads. Contract with test steps: see block comment above.
 */
export function packageAndUpload(cfg: Config, output: BunOutput): void {
  if (!isBuildkite || cfg.mode !== "link-only") return;

  const exe = output.exe;
  if (exe === undefined) {
    throw new BuildError("link-only packaging: output.exe unset");
  }

  const buildDir = cfg.buildDir;
  const exeName = bunExeName(cfg); // bun-profile, bun-asan, etc.
  const bunTriplet = computeBunTriplet(cfg);

  // ─── features.json ───
  // Run the built bun with features.mjs to dump its feature flags.
  // Env vars match cmake's (BuildBun.cmake ~1462).
  // No setarch wrapper — cmake doesn't use one for features.mjs either
  // (only for the --revision smoke test).
  // Cross-compiled binaries can't run on the build host — every field is a
  // build-time constant, so generate the same payload host-side instead
  // (the feature list is parsed out of src/analytics/lib.rs; see
  // features-json.ts).
  if (cfg.crossTarget !== undefined) {
    console.log("Generating features.json (host-side; cross-compiled binary cannot run here)...");
    writeFileSync(resolve(buildDir, "features.json"), crossFeaturesJson(cfg));
  } else {
    console.log("Generating features.json...");
    run([exe, resolve(cfg.cwd, "scripts", "features.mjs")], buildDir, {
      BUN_GARBAGE_COLLECTOR_LEVEL: "1",
      BUN_DEBUG_QUIET_LOGS: "1",
      BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
    });
  }

  const zipPaths: string[] = [];

  // ─── Profile/variant zip ───
  // cmake's bunPath: string(REPLACE bun ${bunTriplet} bunPath ${bun})
  // where ${bun} is the target name (bun-profile, bun-asan, ...).
  // Result: bun-linux-x64-profile, bun-linux-x64-asan, etc.
  const bunPath = exeName.replace(/^bun/, bunTriplet);
  const files: string[] = [basename(exe), "features.json"];
  // Debug symbols / linker map — platform-specific extras.
  if (cfg.windows) {
    files.push(`${exeName}.pdb`);
  } else if (cfg.darwin) {
    files.push(`${exeName}.dSYM`);
  }
  // Linker map: posix non-asan (cmake gate: (APPLE OR LINUX) AND NOT ENABLE_ASAN).
  if (cfg.unix && !cfg.asan) {
    files.push(`${exeName}.linker-map`);
  }
  // The symbol ordering file this binary was linked with, next to the linker
  // map. Skip the seeded placeholder — it has no functions in it.
  const hasOrderFile = usesOrderFile(cfg) && orderFileFunctionCount(cfg) > 0;
  if (hasOrderFile) {
    files.push(basename(orderFilePath(cfg)));
  }
  zipPaths.push(makeZip(cfg, bunPath, files));

  // Also upload it standalone, so the next build inherits it with a small
  // download instead of pulling the whole profile zip. Named per target.
  // Relative, like makeZip's return — upload() runs with cwd = buildDir.
  if (hasOrderFile) {
    const artifact = orderFileArtifact(cfg);
    cpSync(orderFilePath(cfg), resolve(buildDir, artifact));
    zipPaths.push(artifact);
  }

  // ─── Stripped zip ───
  // Only for plain release (shouldStrip). Just the stripped `bun` binary.
  // cmake: bunStripPath = string(REPLACE bun ${bunTriplet} bunStripPath bun) = bunTriplet.
  if (shouldStrip(cfg) && output.strippedExe !== undefined) {
    zipPaths.push(makeZip(cfg, bunTriplet, [basename(output.strippedExe)]));
    const bytes = statSync(output.strippedExe).size;
    run(["buildkite-agent", "meta-data", "set", `binary-size:${bunTriplet}`, String(bytes)], buildDir);
  }

  // ─── Upload ───
  console.log(`Uploading ${zipPaths.length} zips...`);
  upload(zipPaths, buildDir);
}

/**
 * Create a zip at buildDir/${name}.zip containing buildDir/${name}/<files>.
 *
 * Uses `cmake -E tar cfv x.zip --format=zip` — cmake's cross-platform
 * zip wrapper (wraps libarchive). GNU tar (Linux default) DOESN'T support
 * --format=zip; bsdtar does but isn't guaranteed on Linux. cmake is
 * already a required tool (we use it for nested dep builds), so this
 * adds no new dependency. Identical to cmake's own packaging approach
 * (BuildBun.cmake:1544).
 *
 * Files that don't exist are silently skipped (e.g., .pdb on a clean build).
 * Returns the zip path relative to buildDir (for the upload call).
 */
function makeZip(cfg: Config, name: string, files: string[]): string {
  const buildDir = cfg.buildDir;
  const stageDir = resolve(buildDir, name);
  const zip = `${name}.zip`;

  // Clean previous run (idempotent).
  rmSync(stageDir, { recursive: true, force: true });
  rmSync(resolve(buildDir, zip), { force: true });
  mkdirSync(stageDir, { recursive: true });

  // Copy files that exist. Some debug outputs (.pdb, .dSYM, .linker-map)
  // are optional depending on build config — skip rather than fail so a
  // missing optional file doesn't break packaging.
  let copied = 0;
  for (const f of files) {
    const src = resolve(buildDir, f);
    if (!existsSync(src)) {
      console.log(`  (skip missing: ${f})`);
      continue;
    }
    cpSync(src, resolve(stageDir, basename(f)), { recursive: true });
    copied++;
  }

  console.log(`Creating ${zip} (${copied} files)...`);
  // Relative path `name` puts `name/` prefix inside the zip — what test
  // steps expect: they extract → `chmod +x ${triplet}/bun`.
  run([cfg.cmake, "-E", "tar", "cfv", zip, "--format=zip", name], buildDir);

  // Clean up the staging dir.
  rmSync(stageDir, { recursive: true, force: true });

  return zip;
}

/**
 * Download artifacts from sibling buildkite steps before a link-only build.
 * Derives sibling step keys from BUILDKITE_STEP_KEY (swap `-build-bun` →
 * `-build-cpp` / `-build-rust`). Gunzips any .gz files after download.
 *
 * Call BEFORE ninja — the downloaded files are ninja's link inputs.
 */
export async function downloadArtifacts(cfg: Config): Promise<void> {
  if (cfg.mode !== "link-only") return;

  const stepKey = process.env.BUILDKITE_STEP_KEY;
  if (stepKey === undefined) {
    throw new BuildError("BUILDKITE_STEP_KEY unset", {
      hint: "link-only mode requires running inside a Buildkite job",
    });
  }

  // step key is `<target>-build-bun`; siblings are `<target>-build-{cpp,rust}`.
  const m = stepKey.match(/^(.+)-build-bun$/);
  if (m === null) {
    throw new BuildError(`Unexpected BUILDKITE_STEP_KEY: ${stepKey}`, {
      hint: "Expected format: <target>-build-bun",
    });
  }
  const targetKey = m[1]!;

  // Both downloads at once (buildkite-agent already parallelizes within a
  // step's artifact set; this overlaps the two STEPS). Gunzip after BOTH
  // complete — the rust .a is gzipped too on posix, and the .gz scan is a
  // recursive walk so we want every artifact on disk first.
  const dl = (suffix: "cpp" | "rust") => {
    const step = `${targetKey}-build-${suffix}`;
    console.log(`Downloading artifacts from ${step}...`);
    return runAsync(["buildkite-agent", "artifact", "download", "*", ".", "--step", step], cfg.buildDir);
  };
  await Promise.all([dl("cpp"), dl("rust")]);

  // Recursive: rust artifact lands under rust-target/<triple>/<profile>/.
  const gzFiles: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".gz")) gzFiles.push(relative(cfg.buildDir, p));
    }
  };
  walk(cfg.buildDir);
  await Promise.all(
    gzFiles.map(gz => {
      console.log(`Decompressing ${gz}...`);
      return runAsync(["gunzip", "-f", gz], cfg.buildDir);
    }),
  );
}

/** Run a command synchronously, throw BuildError on non-zero exit. */
function run(argv: string[], cwd: string, env?: Record<string, string>): void {
  const result = spawnSync(argv[0]!, argv.slice(1), {
    cwd,
    stdio: "inherit",
    env: env ? { ...process.env, ...env } : undefined,
  });
  if (result.error) {
    throw new BuildError(`Failed to spawn ${argv[0]}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new BuildError(`${argv[0]} exited with code ${result.status}`, {
      hint: `Command: ${argv.join(" ")}`,
    });
  }
}

/** Async variant of `run()` for overlapping independent steps. */
function runAsync(argv: string[], cwd: string): Promise<void> {
  return new Promise((res, rej) => {
    const child = nodeSpawn(argv[0]!, argv.slice(1), { cwd, stdio: "inherit" });
    child.on("error", (err: Error) => rej(new BuildError(`Failed to spawn ${argv[0]}`, { cause: err })));
    child.on("close", (code: number | null) => {
      if (code === 0) res();
      else rej(new BuildError(`${argv[0]} exited with code ${code}`, { hint: `Command: ${argv.join(" ")}` }));
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Symbol ordering file
//
// A build either generates one (trace its own binary, relink against the result)
// or inherits an earlier build's and links once. Releases generate, canaries
// inherit, PRs do neither; one that inherits nothing generates, seeding the chain.
// ═══════════════════════════════════════════════════════════════════════════

/** Cap on builds we ask for an order file before giving up and generating one. */
const PREVIOUS_BUILDS_TO_TRY = 50;

/** Bound on the number-probe fallback: a branch is sparse among build numbers. */
const NUMBER_PROBE_BUDGET = 200;

/** Per-attempt cap, so a hung agent cannot blow the step's budget. */
const ARTIFACT_DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * The CI facts the order-file decisions depend on. Passed in rather than read
 * from `process.env` inside, so the decisions are pure and testable.
 */
export interface OrderFileContext {
  buildkite: boolean;
  /** Buildkite build URL of the running build, for walking the branch. */
  buildUrl: string | undefined;
  branch: string | undefined;
  buildNumber: number | undefined;
  stepKey: string | undefined;
  commitMessage: string;
  pullRequest: boolean;
}

/** Read the environment once, at the edge. */
export function orderFileContext(): OrderFileContext {
  const pr = process.env.BUILDKITE_PULL_REQUEST;
  return {
    buildkite: isBuildkite,
    buildUrl: process.env.BUILDKITE_BUILD_URL,
    branch: process.env.BUILDKITE_BRANCH,
    buildNumber: Number(process.env.BUILDKITE_BUILD_NUMBER) || undefined,
    stepKey: process.env.BUILDKITE_STEP_KEY,
    commitMessage: process.env.BUILDKITE_MESSAGE ?? "",
    pullRequest: pr !== undefined && pr !== "" && pr !== "false",
  };
}

/** Only builds that link, on targets that use an order file, outside PRs. */
export function orderFileEligible(cfg: Config, ctx: OrderFileContext): boolean {
  if (!usesOrderFile(cfg) || !ctx.buildkite || ctx.pullRequest) return false;
  return cfg.mode === "full" || cfg.mode === "link-only";
}

/** Tracing runs the binary we just linked, which a cross build cannot execute. */
function canTraceOrderFile(cfg: Config): boolean {
  return cfg.crossTarget === undefined;
}

/** Artifact name for the standalone order file: `bun-linux-x64.order`. */
function orderFileArtifact(cfg: Config): string {
  return `${computeBunTriplet(cfg)}.order`;
}

/** "1m4s" / "12s" — durations show up in every order-file log line. */
function since(start: number): string {
  const seconds = Math.round((Date.now() - start) / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m${seconds % 60}s` : `${seconds}s`;
}

/** Functions listed in the order file. 0 for the seeded placeholder or no file. */
function orderFileFunctionCount(cfg: Config): number {
  const path = orderFilePath(cfg);
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line: string) => line && !line.startsWith("#")).length;
}

/**
 * Releases always trace their own binary — it is the artifact people install.
 * A canary only does so on request, since it costs a second link.
 */
export function shouldGenerateOrderFile(cfg: Config, ctx: OrderFileContext): boolean {
  if (!orderFileEligible(cfg, ctx) || !canTraceOrderFile(cfg)) return false;
  if (!cfg.canary) return true;
  return /\[generate symbol order\]/i.test(ctx.commitMessage);
}

/**
 * A build that inherited nothing must generate: otherwise it publishes nothing,
 * the next build inherits nothing either, and the chain never recovers.
 */
export function mustGenerateOrderFile(cfg: Config, ctx: OrderFileContext, inherited: boolean): boolean {
  if (shouldGenerateOrderFile(cfg, ctx)) return true;
  return orderFileEligible(cfg, ctx) && canTraceOrderFile(cfg) && !inherited;
}

/**
 * Builds on this branch that might have published an order file, newest first.
 * Lazy: the first candidate is nearly always the answer and the caller stops
 * there, so the happy path is one lookup.
 */
async function* candidateBuilds(ctx: OrderFileContext): AsyncGenerator<{ id: string; number?: number }> {
  const { branch, buildUrl } = ctx;
  if (!branch || !buildUrl) return;

  // https://buildkite.com/<org>/<pipeline>/builds/<n> -> https://buildkite.com/<org>/<pipeline>
  const url = new URL(buildUrl);
  const pipeline = new URL(url.pathname.replace(/\/builds\/.*$/, ""), url.origin).toString();

  const fetchBuild = async (target: string): Promise<any | undefined> => {
    const response: { error?: unknown; body?: any } = await utils.curl(target, { json: true, cache: true });
    return response.error ? undefined : response.body;
  };

  const seen = new Set<string>();

  // Buildkite dropped `prev_branch_build` from the public build JSON, so
  // `utils.getLastSuccessfulBuild()` always returns undefined. This redirect is
  // what works unauthenticated; it drops the `.json`, so read it rather than follow it.
  const newest = await (async () => {
    try {
      const latest = `${pipeline}/builds/latest?branch=${encodeURIComponent(branch)}&state=passed`;
      const location = (await fetch(latest, { redirect: "manual" })).headers.get("location");
      return location ? await fetchBuild(`${location}.json`) : undefined;
    } catch {
      return undefined;
    }
  })();
  if (newest?.id) {
    seen.add(newest.id);
    yield { id: newest.id, number: newest.number };
  }

  // Probe downwards from this build, not from the newest passed one: a build can
  // fail its tests and still have linked and published.
  let number = ctx.buildNumber;
  if (number === undefined) return;

  for (let probes = 0; probes < NUMBER_PROBE_BUDGET; probes++) {
    number -= 1;
    if (number < 1) return;
    const body = await fetchBuild(`${pipeline}/builds/${number}.json`);
    if (!body?.id || body.branch_name !== branch || seen.has(body.id)) continue;
    seen.add(body.id);
    yield { id: body.id, number: body.number };
  }
}

/**
 * Pull an earlier build's order file so this build links ordered without tracing.
 * Downloads the small standalone `.order` artifact, not the profile zip it also
 * rides in. Best-effort: no file means an unordered link, never a failed build.
 */
export async function inheritOrderFile(cfg: Config, ctx: OrderFileContext): Promise<boolean> {
  if (!orderFileEligible(cfg, ctx) || shouldGenerateOrderFile(cfg, ctx)) return false;
  const start = Date.now();
  const artifact = orderFileArtifact(cfg);

  if (!ctx.stepKey) {
    console.log("~ symbol order: BUILDKITE_STEP_KEY unset — linking unordered");
    return false;
  }

  console.log(`Looking for ${artifact} published by an earlier build on ${ctx.branch}...`);
  const downloaded = resolve(cfg.buildDir, artifact);
  let tried = 0;

  for await (const build of candidateBuilds(ctx)) {
    if (++tried > PREVIOUS_BUILDS_TO_TRY) break;
    const result = spawnSync(
      "buildkite-agent",
      ["artifact", "download", artifact, ".", "--step", ctx.stepKey, "--build", build.id],
      { cwd: cfg.buildDir, stdio: "ignore", timeout: ARTIFACT_DOWNLOAD_TIMEOUT_MS },
    );
    if (result.status !== 0 || !existsSync(downloaded)) {
      console.log(`  #${build.number ?? "?"}: no ${artifact} (cancelled, failed, or too old) — looking further back`);
      continue;
    }

    cpSync(downloaded, orderFilePath(cfg));
    rmSync(downloaded, { force: true });
    // An empty artifact would make us publish nothing, breaking the next build.
    const functions = orderFileFunctionCount(cfg);
    if (functions === 0) {
      console.log(`  #${build.number ?? "?"}: ${artifact} is empty — looking further back`);
      continue;
    }

    console.log(
      `+ symbol order: inherited ${artifact}, ${functions} functions from #${build.number ?? "?"} in ${since(start)}`,
    );
    return true;
  }

  const what =
    tried === 0 ? "found no earlier build to inherit from" : `none of the ${tried} builds tried published it`;
  console.log(`~ symbol order: ${what} (${since(start)})`);
  return false;
}

/**
 * Trace the binary from pass 1 and overwrite the order file. The caller re-runs
 * ninja, which relinks and nothing else: `linkDepends()` lists the order file,
 * so it is the only edge whose input changed.
 */
export function regenerateOrderFile(cfg: Config, ctx: OrderFileContext): void {
  const start = Date.now();
  const exeName = bunExeName(cfg); // bun-profile, or bun-assertions on an assertions build
  const why = !cfg.canary
    ? "release build"
    : shouldGenerateOrderFile(cfg, ctx)
      ? "[generate symbol order] in the commit message"
      : "nothing to inherit";
  console.log(`Tracing ${exeName} to build a fresh order file (${why})`);
  console.log("Each workload runs under an LD_PRELOAD page-fault tracer, so it is slower than a normal run.\n");

  const { count } = generateOrderFile({ buildDir: cfg.buildDir, exeName, verbose: true });

  console.log(`\n+ symbol order: traced ${count} functions in ${since(start)} — relinking against them`);
}

/**
 * A canary found nothing to inherit and is paying a second link to seed the
 * chain. Expected once; on every build it means inheriting is broken.
 */
export function reportOrderFileBootstrap(cfg: Config): void {
  if (!cfg.canary) return; // a release always generates — nothing to report
  const message =
    `No earlier build published ${orderFileArtifact(cfg)}, so this build is tracing its own binary and ` +
    `relinking (one extra link). Expected once, to seed the chain. If every build on this branch says ` +
    `this, inheriting is broken — check the "Inherit symbol order file" step.`;
  console.log(`~ symbol order: ${message}`);
  if (!isBuildkite) return;
  utils.reportAnnotationToBuildKite({
    style: "warning",
    priority: 5,
    label: "symbol order file",
    content: utils.formatAnnotationToHtml({
      filename: "scripts/build/ci.ts",
      title: "symbol order file: nothing to inherit, generating from scratch",
      content: message,
      source: "build",
      level: "warning",
    }),
  });
}

/**
 * The trace failed. Ship the unordered binary — correct, just fatter in resident
 * pages — but annotate, so this cannot rot into a permanently unordered release.
 */
export function reportOrderFileFailure(error: Error): void {
  console.error(`- symbol order: FAILED to generate — ${error.message}`);
  console.error("- symbol order: linking unordered. The binary is correct; it just faults in more pages at startup.");
  if (!isBuildkite) return;
  utils.reportAnnotationToBuildKite({
    // Not an error: the build is fine. A red annotation would read as a failure.
    style: "warning",
    priority: 5,
    label: "symbol order file",
    content: utils.formatAnnotationToHtml({
      filename: "scripts/orderfile/generate.ts",
      title: "symbol order file not generated — shipped unordered",
      content: error.message,
      source: "build",
      level: "warning",
    }),
  });
}

/**
 * Prove the relink honoured the order file: one lld silently ignores produces a
 * binary indistinguishable from an unordered one. Scale-free — compare where the
 * hot functions landed against where a typical function landed.
 */
export function verifyOrderFileApplied(cfg: Config, ctx: OrderFileContext, exe: string, { strict = true } = {}): void {
  const SAMPLE = 1000;
  /** Ordered, the hot set sits near the front; unordered, at ~100% of the control. */
  const MAX_FRACTION_OF_CONTROL = 0.4;
  /** Strict mode traced this exact binary, so nearly every name must resolve. */
  const MIN_STRICT_MATCH_RATE = 0.75;

  const start = Date.now();
  if (!orderFileEligible(cfg, ctx)) return;
  const wanted = readFileSync(orderFilePath(cfg), "utf8")
    .split("\n")
    .filter((line: string) => line && !line.startsWith("#"))
    .slice(0, SAMPLE);
  if (wanted.length < SAMPLE) {
    console.log(`~ symbol order: only ${wanted.length} functions in the order file — nothing to verify`);
    return;
  }

  // Same resolution as generate.ts: honor NM, else llvm-nm, else nm.
  let nm = { status: null, stdout: "" } as { status: number | null; stdout: string };
  for (const tool of [process.env.NM, "llvm-nm", "nm"].filter(Boolean) as string[]) {
    nm = spawnSync(tool, ["--defined-only", exe], { encoding: "utf8", maxBuffer: 1 << 29 });
    if (nm.status === 0) break;
  }
  if (nm.status !== 0) {
    console.log("~ symbol order: no working nm — skipping verification");
    return;
  }

  const addresses = new Map<string, number>();
  let textBase = Number.MAX_SAFE_INTEGER;
  for (const line of nm.stdout.split("\n")) {
    const m = /^([0-9a-f]+) ([tT]) (\S+)$/.exec(line);
    if (!m) continue;
    const address = parseInt(m[1]!, 16);
    addresses.set(m[3]!, address);
    if (address < textBase) textBase = address;
  }

  const median = (values: number[]) => (values.length ? values[values.length >> 1]! : 0);
  const sorted = (values: number[]) => values.sort((a, b) => a - b);
  const offsets = sorted(
    wanted
      .map(name => addresses.get(name))
      .filter((address): address is number => address !== undefined)
      .map(address => address - textBase),
  );
  // Where a typical function sits. Ordering does not move this.
  const control = median(sorted([...addresses.values()].map(address => address - textBase)));

  // An inherited file legitimately loses symbols to code churn; one we just
  // generated from this binary has no such excuse, so only that case is fatal.
  const fail = (message: string, hint: string) => {
    if (strict) throw new BuildError(`symbol order: ${message}`, { hint });
    console.log(`~ symbol order: ${message} — ${hint}`);
  };

  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  const rate = offsets.length / wanted.length;
  if (offsets.length === 0) {
    fail(
      "not one of the order file's symbols is in the linked binary",
      "the symbol spellings do not match this link — see scripts/orderfile/generate.ts",
    );
    return;
  }
  if (strict && rate < MIN_STRICT_MATCH_RATE) {
    fail(
      `only ${offsets.length}/${wanted.length} of the order file's symbols are in the binary we traced`,
      "the order file and the link disagree on symbol names — most of the win is being silently lost",
    );
    return;
  }

  const hot = median(offsets);
  if (control > 0 && hot > control * MAX_FRACTION_OF_CONTROL) {
    fail(
      `the order file had no effect: hot functions sit at ${mb(hot)}, a typical one at ${mb(control)}`,
      "lld ignored it — check --symbol-ordering-file and that -ffunction-sections survived",
    );
    return;
  }
  console.log(
    `+ symbol order: applied — ${offsets.length}/${wanted.length} (${(rate * 100).toFixed(0)}%) of the hottest ` +
      `functions resolved; median ${mb(hot)} into .text vs ${mb(control)} for a typical one (${since(start)})`,
  );
}
