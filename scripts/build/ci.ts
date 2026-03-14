/**
 * CI integration: collapsible log groups, environment dump, Buildkite
 * annotations on build failure.
 *
 * Thin layer over `scripts/utils.mjs` — the same helpers the CMake build
 * uses. We import rather than reimplement so CI logs look identical and
 * annotation regex stays in one place.
 */

import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
// @ts-ignore — utils.mjs has JSDoc types but no .d.ts
import * as utils from "../utils.mjs";
import { bunExeName, shouldStrip, type BunOutput } from "./bun.ts";
import type { Config } from "./config.ts";
import { WEBKIT_VERSION } from "./deps/webkit.ts";
import { BuildError } from "./error.ts";
import { ZIG_COMMIT } from "./zig.ts";

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
 * parses the buffer for compiler errors (zig/clang/cmake) and posts each
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
        filename: relative(process.cwd(), import.meta.path),
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
//   build-zig  → bun-zig.o (this node uploads)
//   build-bun  → downloads both, links (this node downloads first)
//
// Paths are uploaded RELATIVE TO buildDir. buildkite-agent recreates the
// directory structure on download. The link-only ninja graph expects files
// at the SAME relative paths cpp-only produced them at — computeDepLibs()
// and emitNestedCmake() share the same path formula.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Upload build artifacts after a successful cpp-only or zig-only build.
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

  if (cfg.mode === "zig-only") {
    const paths = output.zigObjects.map(obj => relative(cfg.buildDir, obj));
    console.log(`Uploading ${paths.length} zig artifacts...`);
    upload(paths, cfg.buildDir);
    return;
  }

  if (cfg.mode !== "cpp-only") {
    // full/link-only don't upload split artifacts.
    return;
  }

  // ─── Phase 1: upload dep libs (before we rm anything) ───
  const depPaths: string[] = [];
  for (const dep of output.deps) {
    for (const lib of dep.libs) {
      depPaths.push(relative(cfg.buildDir, lib));
    }
  }
  console.log(`Uploading ${depPaths.length} dep libs...`);
  upload(depPaths, cfg.buildDir);

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
// Link-only post-link: features.json + link-metadata.json + packaging + upload
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
function computeBunTriplet(cfg: Config): string {
  let t = `bun-${cfg.os}-${cfg.arch}`;
  if (cfg.abi === "musl") t += "-musl";
  if (cfg.baseline) t += "-baseline";
  return t;
}

/**
 * Post-link packaging and upload for link-only mode. Runs AFTER ninja
 * succeeds — at that point bun-profile (and stripped bun) exist.
 *
 * Generates features.json + link-metadata.json, packages into zips,
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
  console.log("Generating features.json...");
  run([exe, resolve(cfg.cwd, "scripts", "features.mjs")], buildDir, {
    BUN_GARBAGE_COLLECTOR_LEVEL: "1",
    BUN_DEBUG_QUIET_LOGS: "1",
    BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
  });

  // ─── link-metadata.json ───
  // Version/webkit/zig info for debugging. Env vars match cmake
  // (BuildBun.cmake ~1253). The script reads the ninja link command too.
  console.log("Generating link-metadata.json...");
  run(
    [process.execPath, resolve(cfg.cwd, "scripts", "create-link-metadata.mjs"), buildDir, exeName + cfg.exeSuffix],
    cfg.cwd,
    {
      BUN_VERSION: cfg.version,
      WEBKIT_VERSION: WEBKIT_VERSION,
      ZIG_COMMIT: ZIG_COMMIT,
      // WEBKIT_DOWNLOAD_URL not available directly; we have the version.
      // The script handles missing env vars (defaults to "").
    },
  );

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
  zipPaths.push(makeZip(cfg, bunPath, files));

  // ─── Stripped zip ───
  // Only for plain release (shouldStrip). Just the stripped `bun` binary.
  // cmake: bunStripPath = string(REPLACE bun ${bunTriplet} bunStripPath bun) = bunTriplet.
  if (shouldStrip(cfg) && output.strippedExe !== undefined) {
    zipPaths.push(makeZip(cfg, bunTriplet, [basename(output.strippedExe)]));
  }

  // ─── Upload ───
  // link-metadata.json uploaded standalone (not in a zip — matches cmake's
  // ARTIFACTS ${BUILD_PATH}/link-metadata.json).
  console.log(`Uploading ${zipPaths.length} zips + metadata...`);
  upload([...zipPaths, "link-metadata.json"], buildDir);
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
 * `-build-cpp` / `-build-zig`). Gunzips any .gz files after download.
 *
 * Call BEFORE ninja — the downloaded files are ninja's link inputs.
 */
export function downloadArtifacts(cfg: Config): void {
  if (cfg.mode !== "link-only") return;

  const stepKey = process.env.BUILDKITE_STEP_KEY;
  if (stepKey === undefined) {
    throw new BuildError("BUILDKITE_STEP_KEY unset", {
      hint: "link-only mode requires running inside a Buildkite job",
    });
  }

  // step key is `<target>-build-bun`; siblings are `<target>-build-{cpp,zig}`.
  const m = stepKey.match(/^(.+)-build-bun$/);
  if (m === null) {
    throw new BuildError(`Unexpected BUILDKITE_STEP_KEY: ${stepKey}`, {
      hint: "Expected format: <target>-build-bun",
    });
  }
  const targetKey = m[1]!;

  for (const suffix of ["cpp", "zig"]) {
    const step = `${targetKey}-build-${suffix}`;
    console.log(`Downloading artifacts from ${step}...`);
    // '*' glob — download everything that step uploaded.
    run(["buildkite-agent", "artifact", "download", "*", ".", "--step", step], cfg.buildDir);
  }

  // Gunzip any compressed archives (libbun-*.a.gz → libbun-*.a).
  // -f: overwrite if already decompressed (idempotent re-run).
  const gzFiles = existsSync(cfg.buildDir)
    ? readdirSync(cfg.buildDir).filter(f => f.endsWith(".gz") && statSync(resolve(cfg.buildDir, f)).isFile())
    : [];
  for (const gz of gzFiles) {
    console.log(`Decompressing ${gz}...`);
    run(["gunzip", "-f", gz], cfg.buildDir);
  }
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
