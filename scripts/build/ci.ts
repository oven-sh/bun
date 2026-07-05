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
// @ts-ignore — utils.mjs has JSDoc types but no .d.ts
import * as utils from "../utils.mjs";
import { generateOrderFile } from "../orderfile/generate.ts";
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
// The order file is a build artifact, never committed. Two ways a build gets one:
//
//   generate — trace this build's own bun-profile, then relink against the
//              result, so the shipped binary is ordered by exactly the
//              functions it runs. Costs a second link (~15-20min on linux).
//              Release builds always do this; any commit can opt in with
//              [generate symbol order].
//   inherit  — download the last successful build's order file for this target
//              and link once. ~90% of symbols still resolve one commit later
//              (100% of the hottest 1000), and lld skips the rest. Free.
//
// Canary inherits; release generates. Nothing on PRs, so a PR can neither pay
// for a relink nor publish a file the next build would inherit.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How far back to look for a publishable order file. Builds get cancelled
 * constantly, and a run of them can be long, so walk generously — this only
 * costs anything when the chain really is broken that far back, and the
 * alternative (giving up) means the next build publishes nothing either and
 * the chain never heals until a release regenerates one.
 */
const PREVIOUS_BUILDS_TO_TRY = 50;

/** Per-attempt cap. 50 hops × a hung agent must not blow the step's budget. */
const ARTIFACT_DOWNLOAD_TIMEOUT_MS = 30_000;

/** Only builds that link, on targets that use an order file, outside PRs. */
export function orderFileEligible(cfg: Config): boolean {
  if (!usesOrderFile(cfg) || !isBuildkite) return false;
  if (cfg.mode !== "full" && cfg.mode !== "link-only") return false;
  return !process.env.BUILDKITE_PULL_REQUEST || process.env.BUILDKITE_PULL_REQUEST === "false";
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
 * Regenerate from this build's own binary and relink? Always for a release —
 * the artifact people actually install is worth the second link. Otherwise
 * opt-in per commit, so a canary can be asked for a fresh file on demand
 * (e.g. after a big refactor moves a lot of code).
 */
export function shouldGenerateOrderFile(cfg: Config): boolean {
  if (!orderFileEligible(cfg)) return false;
  if (!cfg.canary) return true;
  return /\[generate symbol order\]/i.test(process.env.BUILDKITE_MESSAGE ?? "");
}

/**
 * Previous builds on this branch, newest first, walking `prev_branch_build`.
 *
 * Deliberately does NOT filter on build state, unlike `getLastSuccessfulBuild()`
 * — that helper stops at the first terminal build and gives up if its `build-bun`
 * steps didn't all pass, so a single cancelled build (which happens constantly)
 * would break the chain. Here the artifact's *existence* is the success signal:
 * only a build that linked and packaged ever uploads one. So just walk back and
 * take the first build that has the file.
 */
async function previousBuilds(limit: number): Promise<{ id: string; number?: number }[]> {
  const builds: { id: string; number?: number }[] = [];
  let url = utils.getBuildUrl() as URL | undefined;
  if (!url) return builds;
  url.hash = "";

  for (let depth = 0; url && builds.length < limit; depth++) {
    const response: { error?: unknown; body?: any } = await utils.curl(`${url}.json`, { json: true, cache: true });
    const body = response.body;
    if (response.error || !body) break;
    if (depth > 0 && body.id) builds.push({ id: body.id, number: body.number });
    if (!body.prev_branch_build) break;
    url = new URL(body.prev_branch_build["url"], url);
  }
  return builds;
}

/**
 * Pull a previous build's order file for this target, so a build that isn't
 * generating its own still links ordered. Cheap: the standalone `.order`
 * artifact, not the 170MB profile zip it also rides in.
 *
 * Best-effort. No previous file means an unordered link: costs pages, not a build.
 */
export async function inheritOrderFile(cfg: Config): Promise<void> {
  if (!orderFileEligible(cfg) || shouldGenerateOrderFile(cfg)) return;
  const start = Date.now();
  const artifact = orderFileArtifact(cfg);

  const stepKey = process.env.BUILDKITE_STEP_KEY;
  if (!stepKey) {
    console.log("~ symbol order: BUILDKITE_STEP_KEY unset — linking unordered");
    return;
  }

  console.log(`Looking for ${artifact} in the last ${PREVIOUS_BUILDS_TO_TRY} builds on this branch...`);
  const candidates = await previousBuilds(PREVIOUS_BUILDS_TO_TRY);
  if (candidates.length === 0) {
    console.log(`~ symbol order: no previous build on this branch (${since(start)}) — linking unordered`);
    return;
  }

  const downloaded = resolve(cfg.buildDir, artifact);
  for (const build of candidates) {
    const result = spawnSync(
      "buildkite-agent",
      ["artifact", "download", artifact, ".", "--step", stepKey, "--build", build.id],
      { cwd: cfg.buildDir, stdio: "ignore", timeout: ARTIFACT_DOWNLOAD_TIMEOUT_MS },
    );
    if (result.status !== 0 || !existsSync(downloaded)) {
      console.log(`  #${build.number ?? "?"}: no ${artifact} (cancelled, failed, or too old) — walking back`);
      continue;
    }

    cpSync(downloaded, orderFilePath(cfg));
    rmSync(downloaded, { force: true });
    console.log(
      `+ symbol order: inherited ${artifact}, ${orderFileFunctionCount(cfg)} functions ` +
        `from build #${build.number ?? "?"} in ${since(start)}`,
    );
    return;
  }

  console.log(
    `~ symbol order: none of the last ${candidates.length} builds published ${artifact} ` +
      `(${since(start)}) — linking unordered`,
  );
}

/**
 * After pass 1: trace this build's binary and overwrite the order file. The
 * caller must re-run ninja, which relinks and nothing else — `linkDepends()`
 * lists the order file, so it is the only edge whose input changed.
 */
export function regenerateOrderFile(cfg: Config): void {
  const start = Date.now();
  const exeName = bunExeName(cfg); // bun-profile, or bun-assertions on an assertions build
  const why = cfg.canary ? "[generate symbol order] in the commit message" : "release build";
  console.log(`Tracing ${exeName} to build a fresh order file (${why})`);
  console.log("Each workload runs under an LD_PRELOAD page-fault tracer, so it is slower than a normal run.\n");

  const { count } = generateOrderFile({ buildDir: cfg.buildDir, exeName, verbose: true });

  console.log(`\n+ symbol order: traced ${count} functions in ${since(start)} — relinking against them`);
}

/**
 * The trace failed. Ship the unordered binary — it is correct, just fatter in
 * resident pages — but leave a PR-visible annotation so this cannot rot into a
 * permanently unordered release nobody notices.
 */
export function reportOrderFileFailure(error: Error): void {
  console.error(`- symbol order: FAILED to generate — ${error.message}`);
  console.error("- symbol order: linking unordered. The binary is correct; it just faults in more pages at startup.");
  if (!isBuildkite) return;
  utils.reportAnnotationToBuildKite({
    // Not an error: the build is fine, the binary is correct, it just faults in
    // more pages. A red annotation here would read as a failed release.
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
 * Prove the relink honoured the order file. An order file lld silently ignores
 * (wrong symbol spellings, `-ffunction-sections` lost, flag dropped) produces a
 * binary indistinguishable from an unordered one, and we would never notice.
 *
 * The test is scale-free: compare where the order file's hottest functions
 * landed against where a typical function landed. Ordered, the hot set clusters
 * near the front of `.text` and its median offset is a small fraction of the
 * median over all functions. Unordered, the two medians are the same number.
 * (A fixed byte threshold would not do: `.text` grows, and a hot set that
 * happens to sit in the first 40% of an unordered `.text` would sail past it.)
 */
export function verifyOrderFileApplied(cfg: Config, exe: string, { strict = true } = {}): void {
  const SAMPLE = 1000;
  /** Ordered, hot symbols land within a few percent of .text. Unordered, at ~100% of the control. */
  const MAX_FRACTION_OF_CONTROL = 0.4;
  /** Strict mode traced this exact binary, so nearly every name must resolve. */
  const MIN_STRICT_MATCH_RATE = 0.75;

  const start = Date.now();
  if (!orderFileEligible(cfg)) return;
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
  // The control: where a typical function sits. Ordering does not move this.
  const control = median(sorted([...addresses.values()].map(address => address - textBase)));

  // An inherited file legitimately loses symbols to code churn (~10% one commit
  // later), so a soft failure there is information, not a broken build. A file
  // we just generated from this exact binary has no such excuse — and an order
  // file the linker ignored is a real bug in the build, not a flaky workload,
  // so unlike a failed trace it does stop the build.
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
