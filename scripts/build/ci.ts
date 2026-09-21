/**
 * CI integration: collapsible log groups, environment dump, Buildkite
 * annotations on build failure.
 *
 * Thin layer over `scripts/buildkite.ts`, which the test runner and the
 * pipeline generator use too, so CI logs and annotations look the same
 * whichever of them wrote them.
 */

import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isBuildkite, markBuildkiteStepReported, reportAnnotationToBuildkite } from "../buildkite.ts";
import { readTextSymbols } from "../orderfile/generate.ts";
import { formatAnnotationToHtml, parseAnnotations } from "./annotations.ts";
import { bunExeName, shouldStrip, type BunOutput } from "./bun.ts";
import type { Config } from "./config.ts";
import { webkitTestFFIPath } from "./deps/webkit.ts";
import { BuildError } from "./error.ts";
import { crossFeaturesJson } from "./features-json.ts";
import { linkerMapOutputs, orderFilePath, usesOrderFile } from "./flags.ts";

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
      const { annotations } = parseAnnotations(annotatable);
      for (const ann of annotations) {
        reportAnnotationToBuildkite({
          priority: 10,
          label: ann.title,
          content: formatAnnotationToHtml(ann),
        });
        annotated = true;
      }
    } catch (err) {
      console.error("Failed to parse annotations:", err);
    }

    // Nothing matched the compiler-error regexes → post a generic annotation
    // with the full buffered output so there's still a PR-visible signal.
    if (!annotated) {
      const content = formatAnnotationToHtml({
        filename: relative(process.cwd(), fileURLToPath(import.meta.url)),
        title: "build failed",
        content: buffer,
        source: "build",
        level: "error",
      });
      reportAnnotationToBuildkite({
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

  markBuildkiteStepReported();
  process.exit(exitCode ?? 1);
}

// ───────────────────────────────────────────────────────────────────────────
// Buildkite artifacts — split-build upload/download
//
// CI splits builds per-platform into three parallel steps:
//   build-cpp  → libbun.a + all dep libs (this node uploads)
//   build-rust → libbun_runtime.a (this node uploads)
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
    // the rust/<triple>/ layout that `rustLibPath(cfg)`
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

  const testFFI = webkitTestFFIPath(cfg);
  if (existsSync(testFFI)) {
    console.log("Uploading testFFI...");
    upload([relative(cfg.buildDir, testFFI)], cfg.buildDir);
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
    // The build's own cache only: one placed elsewhere (--cacheDir, $BUN_BUILD_CACHE_DIR) is not this build's disk to free.
    const cacheFromBuildDir = relative(cfg.buildDir, cfg.cacheDir);
    if (!cacheFromBuildDir.startsWith("..") && !isAbsolute(cacheFromBuildDir)) {
      rmSync(cfg.cacheDir, { recursive: true, force: true });
    }

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

/**
 * The timings chart's file: `timings.html`, or under Buildkite a name with the step's key in it. Every build step of
 * a build uploads its own, and the key is what tells them apart (two steps can share a target and a mode:
 * `linux-x64` and `linux-x64-asan`).
 */
export function timingsChartName(): string {
  return isBuildkite ? chartOfStep(process.env.BUILDKITE_STEP_KEY!) : "timings.html";
}

const chartOfStep = (stepKey: string): string => `timings-${stepKey}.html`;

/**
 * Put a build step's timings chart where someone looking at the build finds it: uploaded as an artifact, which
 * Buildkite serves as a page, and linked from the build page, in one annotation that folds away.
 *
 * Every build step has a chart and no step runs after them all, so each writes the whole annotation: it records its
 * chart in the build's meta-data and lists every chart recorded so far. Two steps finishing together can each list
 * the charts it saw, and the later write may be the one that saw fewer; so a step looks again after writing and
 * writes again if the list grew. The last write of all was then checked against a list that had every chart.
 */
export function publishTimings(cfg: Config, chart: string): void {
  // The link resolves only once the artifact exists.
  upload([relative(cfg.buildDir, chart)], cfg.buildDir);
  run(
    ["buildkite-agent", "meta-data", "set", `${TIMINGS_META_DATA}${process.env.BUILDKITE_STEP_KEY}`, "1"],
    cfg.buildDir,
  );
  const recorded = (): string[] => {
    const keys = spawnSync("buildkite-agent", ["meta-data", "keys"], { encoding: "utf8" });
    if (keys.status !== 0) throw new BuildError(`buildkite-agent meta-data keys exited with code ${keys.status}`);
    const all = keys.stdout.split("\n").map(k => k.trim());
    return all
      .filter(k => k.startsWith(TIMINGS_META_DATA))
      .map(k => k.slice(TIMINGS_META_DATA.length))
      .sort();
  };
  for (let written: string[] = [], steps = recorded(); steps.join() !== written.join(); steps = recorded()) {
    const links = steps.map(step => `<li><a href="artifact://${chartOfStep(step)}">${step}</a></li>`);
    reportAnnotationToBuildkite({
      style: "info",
      priority: 1,
      label: "build timings",
      append: false,
      content: `<details>\n<summary>⏱️ Build timings</summary>\n<ul>\n${links.join("\n")}\n</ul>\n</details>\n`,
    });
    written = steps;
  }
}

/** The build's meta-data key of a step that uploaded a timings chart, before the step's key. */
const TIMINGS_META_DATA = "timings:";

// ───────────────────────────────────────────────────────────────────────────
// Link-only post-link: features.json + packaging + upload
//
// The zip contract (matching cmake's BuildBun.cmake packaging — test steps
// download these by exact name):
//
//   ${bunTriplet}-profile.zip   (plain release)
//     └── ${bunTriplet}-profile/
//           ├── bun-profile[.exe]
//           ├── testFFI[.exe]            (WebKit FFI test binary, when shipped)
//           ├── features.json
//           ├── bun-profile.linker-map   (linkerMapOutputs: release, non-asan)
//           ├── bun-profile.map          (windows; with the above, what the
//           │                             trace-order step resolves addresses with)
//           ├── linker.order             (the order file this binary was linked with, if any)
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
// Test steps (runner.node.ts) download '**' from build-bun and pick any
// bun*.zip; baseline-verification step downloads ${triplet}.zip specifically
// and expects ${triplet}/bun inside.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Base triplet (bun-os-arch[-musl][-baseline]). Variant suffix (-profile,
 * -asan) is added by the caller. Matches ci.ts getTargetTriplet() and
 * cmake's bunTriplet — any drift breaks test-step downloads.
 */
export function computeBunTriplet(cfg: Config): string {
  let t = `bun-${cfg.os}-${cfg.arch}`;
  if (cfg.abi === "musl") t += "-musl";
  if (cfg.abi === "android") t += "-android";
  // No `-baseline` suffix: x64 is always baseline and the historical
  // `-baseline` names are published as release-side aliases.
  return t;
}

/**
 * Post-link packaging and upload for the modes that link in CI. Runs
 * AFTER ninja succeeds — at that point bun-profile (and stripped bun) exist.
 *
 * Generates features.json, packages into zips,
 * uploads. Contract with test steps: see block comment above.
 */
export function packageAndUpload(cfg: Config, output: BunOutput): void {
  if (!isBuildkite) return;

  const exe = output.exe;
  if (exe === undefined) {
    throw new BuildError(`${cfg.mode} packaging: output.exe unset`);
  }

  const buildDir = cfg.buildDir;
  const exeName = bunExeName(cfg); // bun-profile, bun-asan, etc.
  const bunTriplet = computeBunTriplet(cfg);

  // ─── features.json ───
  // Run the built bun with features.ts to dump its feature flags.
  // Binaries that can't run on this host: every field is a build-time
  // constant, so generate the same payload host-side instead (the feature
  // list is parsed out of src/analytics/lib.rs; see features-json.ts).
  if (!cfg.canRunOnHost) {
    console.log("Generating features.json (host-side; cross-compiled binary cannot run here)...");
    writeFileSync(resolve(buildDir, "features.json"), crossFeaturesJson(cfg));
  } else {
    console.log("Generating features.json...");
    run([exe, resolve(cfg.cwd, "scripts", "features.ts")], buildDir, {
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
  const testFFI = webkitTestFFIPath(cfg);
  if (existsSync(testFFI)) {
    chmodSync(testFFI, 0o755);
    files.push(testFFI);
  }
  // Debug symbols / linker map — platform-specific extras.
  if (cfg.windows) {
    files.push(`${exeName}.pdb`);
  } else if (cfg.darwin) {
    files.push(`${exeName}.dSYM`);
  }
  // Linker map(s). On windows they are also what the trace-order step
  // (.buildkite/ci.ts) resolves traced addresses against, the PE itself
  // having no symbol table, so without them that step has nothing to work from.
  files.push(...linkerMapOutputs(cfg).map(map => basename(map)));
  // The symbol ordering file this binary was linked with, next to the linker
  // map. Skip the seeded placeholder — it has no functions in it.
  const hasOrderFile = usesOrderFile(cfg) && orderFileFunctionCount(cfg) > 0;
  if (hasOrderFile) {
    files.push(basename(orderFilePath(cfg)));
  }
  zipPaths.push(makeZip(cfg, bunPath, files));

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
 * Download artifacts from sibling buildkite steps before a link-only /
 * rust-and-link build. Derives sibling step keys from BUILDKITE_STEP_KEY
 * (swap `-build-bun` → `-build-cpp` / `-build-rust`). Gunzips any .gz files
 * after download.
 *
 * rust-and-link runs in parallel with build-cpp (no depends_on), so it
 * POLLS `buildkite-agent step get outcome` for the cpp step until it passes
 * before attempting the download. link-only has depends_on and skips the
 * poll.
 *
 * Call BEFORE ninja — the downloaded files are ninja's link inputs.
 */
export async function downloadArtifacts(cfg: Config): Promise<void> {
  if (cfg.mode !== "link-only" && cfg.mode !== "rust-and-link") return;

  const stepKey = process.env.BUILDKITE_STEP_KEY;
  if (stepKey === undefined) {
    throw new BuildError("BUILDKITE_STEP_KEY unset", {
      hint: `${cfg.mode} mode requires running inside a Buildkite job`,
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
  const cppStep = `${targetKey}-build-cpp`;

  // rust-and-link: no depends_on on build-cpp (it started alongside us so
  // cargo could overlap). Poll its outcome; "passed" → download, any
  // terminal failure → exit 1 with a clear message so the annotation points
  // at build-cpp rather than a confusing "artifact not found" here.
  if (cfg.mode === "rust-and-link") {
    await waitForStepOutcome(cppStep);
  }

  const dl = (step: string) => {
    console.log(`Downloading artifacts from ${step}...`);
    return runAsync(["buildkite-agent", "artifact", "download", "*", ".", "--step", step], cfg.buildDir);
  };
  if (cfg.mode === "rust-and-link") {
    // rust built locally — only the cpp archive + dep libs are fetched.
    await dl(cppStep);
  } else {
    // link-only: both siblings. Overlap the two downloads; gunzip after both
    // complete (the .gz scan is a recursive walk, so everything on disk first).
    await Promise.all([dl(cppStep), dl(`${targetKey}-build-rust`)]);
  }

  // Recursive: rust artifact lands under rust/<triple>/.
  const gzFiles: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) {
        // rust-and-link built rust locally; skip the per-crate artifact tree.
        if (cfg.mode === "rust-and-link" && (e.name === "rust" || e.name === "rust-target")) continue;
        walk(p);
      } else if (e.isFile() && e.name.endsWith(".gz")) gzFiles.push(relative(cfg.buildDir, p));
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

/**
 * Poll `buildkite-agent step get outcome --step <key>` until the step
 * reaches a terminal state. Returns on "passed"; throws on any failure
 * outcome so the caller exits 1 with a message that points at the real
 * failing step (rather than a downstream "artifact not found").
 */
async function waitForStepOutcome(stepKey: string): Promise<void> {
  const failed = new Set(["hard_failed", "soft_failed", "errored", "canceled", "cancelled"]);
  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
  const start = Date.now();
  const deadlineMs = 60 * 60 * 1000;
  let last = "";
  console.log(`Waiting for ${stepKey} to finish...`);
  for (;;) {
    const result = spawnSync("buildkite-agent", ["step", "get", "outcome", "--step", stepKey], { encoding: "utf8" });
    if (result.error) {
      throw new BuildError(`Failed to spawn buildkite-agent`, { cause: result.error });
    }
    if (result.status !== 0) {
      const err = (result.stderr ?? "").trim();
      if (err !== last) {
        console.log(`  buildkite-agent step get exited ${result.status}: ${err}`);
        last = err;
      }
      if (Date.now() - start > deadlineMs) {
        throw new BuildError(`buildkite-agent step get kept failing for ${stepKey}`, { hint: err });
      }
      await sleep(3000);
      continue;
    }
    const outcome = (result.stdout ?? "").trim();
    if (outcome !== last) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`  ${stepKey} outcome: ${outcome || "(running)"} [${elapsed}s]`);
      last = outcome;
    }
    if (outcome === "passed") return;
    if (failed.has(outcome)) {
      throw new BuildError(`Sibling step ${stepKey} ${outcome} — nothing to link`, {
        hint: `See the ${stepKey} job for the real error; this step only downloads its artifacts.`,
      });
    }
    if (Date.now() - start > deadlineMs) {
      throw new BuildError(`Timed out after 60m waiting for ${stepKey}`, {
        hint: `${stepKey} never reached a terminal outcome; check that job for a hang.`,
      });
    }
    await sleep(3000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Symbol ordering file
//
// No build traces its own binary. Every build, of a pull request too, inherits
// the most recent file a build of the main branch published, and links once
// against it. What publishes it is the target's `-trace-order` step
// (.buildkite/ci.ts), which runs after each main build on a machine that can
// run the binary.
// ═══════════════════════════════════════════════════════════════════════════

/** Cap on probed builds we ask for an order file. The newest passed build is asked on top of these. */
const PREVIOUS_BUILDS_TO_TRY = 50;

/** Bound on the number probe: the main branch is sparse among build numbers. */
const NUMBER_PROBE_BUDGET = 200;

/** Per-attempt cap, so a hung agent cannot blow the step's budget. */
const ARTIFACT_DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * How long a build looks for an order file to inherit. Every build does, and the file is an optimization: past
 * this, a Buildkite that is slow to answer costs the build its ordering, not its time. Finding one takes seconds.
 */
const INHERIT_BUDGET_MS = 120_000;

/**
 * The CI facts the order-file decisions depend on. Passed in rather than read
 * from `process.env` inside, so the decisions are pure and testable.
 */
export interface OrderFileContext {
  buildkite: boolean;
  /** Buildkite build URL of the running build, for walking back from it. */
  buildUrl: string | undefined;
  /** The branch whose builds publish order files: the pipeline's default branch. */
  mainBranch: string | undefined;
  buildNumber: number | undefined;
}

/** Read the environment once, at the edge. */
export function orderFileContext(): OrderFileContext {
  return {
    buildkite: isBuildkite,
    buildUrl: process.env.BUILDKITE_BUILD_URL,
    mainBranch: process.env.BUILDKITE_PIPELINE_DEFAULT_BRANCH,
    buildNumber: Number(process.env.BUILDKITE_BUILD_NUMBER) || undefined,
  };
}

/** Only builds that link, on targets that use an order file. */
export function orderFileEligible(cfg: Config, ctx: OrderFileContext): boolean {
  if (!usesOrderFile(cfg) || !ctx.buildkite) return false;
  return cfg.mode !== "cpp-only" && cfg.mode !== "rust-only";
}

/**
 * An eligible build inherited nothing and is shipping unordered: no recent build of the main branch published
 * this target's order file, so its `-trace-order` step is failing or missing.
 */
export function reportNothingToInherit(cfg: Config): void {
  const msg =
    `${orderFileArtifact(cfg)}: no recent build of the main branch published it, so this build links unordered. ` +
    `The target's trace-order step publishes it after each main build; that step is failing or missing.`;
  warnAboutOrderFile("nothing to inherit, shipping unordered", msg);
}

/** The build is fine and its binary correct, only fatter in resident pages: a line in the log and a warning on the build page. */
function warnAboutOrderFile(title: string, message: string): void {
  console.log(`~ symbol order: ${message}`);
  if (!isBuildkite) return;
  reportAnnotationToBuildkite({
    // Not an error: a red annotation would read as a failed build.
    style: "warning",
    priority: 5,
    label: "symbol order file",
    content: formatAnnotationToHtml({
      filename: "scripts/build/ci.ts",
      title: `symbol order file: ${title}`,
      content: message,
      source: "build",
      level: "warning",
    }),
  });
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

/** The fields of a build's public JSON (`<pipeline>/builds/<n>.json`) that are read here. */
interface BuildJson {
  id?: string;
  number?: number;
  branch_name?: string;
}

/**
 * The unauthenticated Buildkite lookups candidateBuilds() makes. Passed in, like
 * OrderFileContext, so the walk runs offline in a test.
 */
export interface BuildLookups {
  /** A build's public JSON, or undefined when it cannot be read. */
  build(url: string): Promise<BuildJson | undefined>;
  /** Where `url` redirects to, without following it. */
  redirect(url: string): Promise<string | null>;
}

/** The lookups, against buildkite.com, until `signal` aborts them: a request that is cut short finds nothing. */
const buildkiteLookups = (signal: AbortSignal): BuildLookups => ({
  async build(url) {
    try {
      const response = await fetch(url, { signal });
      return response.ok ? ((await response.json()) as BuildJson) : undefined;
    } catch {
      return undefined;
    }
  },
  async redirect(url) {
    try {
      return (await fetch(url, { redirect: "manual", signal })).headers.get("location");
    } catch {
      return null;
    }
  },
});

/**
 * Builds of the main branch that might have published an order file, nearest first.
 * Lazy: the first candidate is nearly always the answer and the caller stops there.
 */
export async function* candidateBuilds(
  ctx: OrderFileContext,
  lookups: BuildLookups,
): AsyncGenerator<{ id: string; number: number | undefined }> {
  const { mainBranch: branch, buildUrl } = ctx;
  if (!branch || !buildUrl) return;

  // https://buildkite.com/<org>/<pipeline>/builds/<n> -> https://buildkite.com/<org>/<pipeline>
  const url = new URL(buildUrl);
  const pipeline = new URL(url.pathname.replace(/\/builds\/.*$/, ""), url.origin).toString();

  const seen = new Set<string>();

  // Probe downwards from this build: the nearest file matches this link best.
  // Rust symbol names embed a per-crate hash that changes with the crate's
  // dependencies or the toolchain, so an older file can lose half its names to
  // one commit. A build can fail its tests, or be cancelled, and still have
  // linked and published.
  let number = ctx.buildNumber;
  for (let probes = 0; number !== undefined && number > 1 && probes < NUMBER_PROBE_BUDGET; probes++) {
    if (seen.size >= PREVIOUS_BUILDS_TO_TRY) break;
    number -= 1;
    const body = await lookups.build(`${pipeline}/builds/${number}.json`);
    if (!body?.id || body.branch_name !== branch) continue;
    seen.add(body.id);
    yield { id: body.id, number: body.number };
  }

  // The branch was quiet for longer than the probe reaches: fall back to its
  // newest passed build. Buildkite dropped `prev_branch_build` from the public
  // build JSON, so `getLastSuccessfulBuild()` always returns undefined.
  // This redirect is what works unauthenticated. Its Location repeats the query
  // (`<pipeline>/builds/116199?branch=main&state=passed`), so `.json` goes on
  // the path: after the query, Buildkite answers with the HTML page.
  const latest = `${pipeline}/builds/latest?branch=${encodeURIComponent(branch)}&state=passed`;
  const location = await lookups.redirect(latest);
  if (!location) return;
  const target = new URL(location, latest);
  const newest = await lookups.build(`${target.origin}${target.pathname}.json`);
  if (newest?.id && !seen.has(newest.id)) yield { id: newest.id, number: newest.number };
}

/**
 * Pull an earlier build's order file so this build links ordered without tracing.
 * Downloads the small standalone `.order` artifact, not the profile zip it also
 * rides in. Best-effort: no file means an unordered link, never a failed build.
 */
export async function inheritOrderFile(cfg: Config, ctx: OrderFileContext): Promise<boolean> {
  if (!orderFileEligible(cfg, ctx)) return false;
  const start = Date.now();
  const artifact = orderFileArtifact(cfg);

  console.log(`Looking for ${artifact} published by an earlier build of ${ctx.mainBranch}...`);
  const downloaded = resolve(cfg.buildDir, artifact);
  let tried = 0;

  const outOfTime = AbortSignal.timeout(INHERIT_BUDGET_MS);
  for await (const build of candidateBuilds(ctx, buildkiteLookups(outOfTime))) {
    if (outOfTime.aborted) break;
    tried++;
    // No --step: exactly one step per build publishes the target-unique name,
    // the target's trace-order step (.buildkite/ci.ts).
    const result = spawnSync("buildkite-agent", ["artifact", "download", artifact, ".", "--build", build.id], {
      cwd: cfg.buildDir,
      stdio: "ignore",
      timeout: ARTIFACT_DOWNLOAD_TIMEOUT_MS,
    });
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

  const what = outOfTime.aborted
    ? "gave up looking for a build to inherit from"
    : tried === 0
      ? "found no earlier build to inherit from"
      : `none of the ${tried} builds tried published it`;
  console.log(`~ symbol order: ${what} (${since(start)})`);
  return false;
}

/**
 * Say whether the link honoured the order file: one lld silently ignores produces a
 * binary indistinguishable from an unordered one. Scale-free — compare where the
 * hot functions landed against where a typical function landed. It reports and
 * never fails the build: the file is inherited, so it legitimately loses names to
 * code churn, and a stale one is a slower binary, not a broken one.
 */
export function verifyOrderFileApplied(cfg: Config, ctx: OrderFileContext, exe: string): void {
  /** Fewer names than this say too little about where the hot set landed. */
  const FEWEST_NAMES = 1000;
  /** Ordered, the hot set sits near the front; unordered, at ~100% of the control. */
  const MAX_FRACTION_OF_CONTROL = 0.4;

  const start = Date.now();
  if (!orderFileEligible(cfg, ctx)) return;
  // Every name in the file, not its first ones: a process enters the C runtime's routines first (memcpy,
  // memset, startup), and on windows x64 those are precompiled code the linker cannot move, in a block of
  // their own at the end of .text. The first thousand names are mostly that block there, and say nothing
  // about the functions that can be ordered.
  const wanted = readFileSync(orderFilePath(cfg), "utf8")
    .split("\n")
    .filter((line: string) => line && !line.startsWith("#"));
  if (wanted.length < FEWEST_NAMES) {
    console.log(`~ symbol order: only ${wanted.length} functions in the order file — nothing to verify`);
    return;
  }

  // The same names the generator traces against: nm's, or on windows the link's maps'.
  let symbols: Map<number, string[]>;
  try {
    symbols = readTextSymbols(exe);
  } catch (error) {
    console.log(
      `~ symbol order: cannot read the binary's symbols — skipping verification (${(error as Error).message})`,
    );
    return;
  }

  const addresses = new Map<string, number>();
  let textBase = Number.MAX_SAFE_INTEGER;
  for (const [address, names] of symbols) {
    for (const name of names) addresses.set(name, address);
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

  const fail = (message: string, hint: string) =>
    warnAboutOrderFile("the link did not honour it", `${orderFileArtifact(cfg)}: ${message} — ${hint}`);

  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  const rate = offsets.length / wanted.length;
  if (offsets.length === 0) {
    fail(
      "not one of the order file's symbols is in the linked binary",
      "the symbol spellings do not match this link — see scripts/orderfile/generate.ts",
    );
    return;
  }
  const hot = median(offsets);
  if (control > 0 && hot > control * MAX_FRACTION_OF_CONTROL) {
    fail(
      `the order file had no effect: hot functions sit at ${mb(hot)}, a typical one at ${mb(control)}`,
      cfg.darwin
        ? "Apple ld ignored it — check -order_file and that the names match nm's"
        : cfg.windows
          ? "lld-link ignored it — check /order and that /Gy survived"
          : "lld ignored it — check --symbol-ordering-file and that -ffunction-sections survived",
    );
    return;
  }
  console.log(
    `+ symbol order: applied — ${offsets.length}/${wanted.length} (${(rate * 100).toFixed(0)}%) of the order ` +
      `file's functions resolved; median ${mb(hot)} into .text vs ${mb(control)} for a typical one (${since(start)})`,
  );
}
