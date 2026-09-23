/**
 * CI integration: collapsible log groups, environment dump, Buildkite
 * annotations on build failure.
 *
 * Thin layer over `scripts/buildkite.ts`, which the test runner and the
 * pipeline generator use too, so CI logs and annotations look the same
 * whichever of them wrote them.
 */

import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isBuildkite, markBuildkiteStepReported, reportAnnotationToBuildkite } from "../buildkite.ts";
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
// Post-link: features.json + packaging + upload
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

/** Targets that use an order file. Every build links. */
export function orderFileEligible(cfg: Config, ctx: OrderFileContext): boolean {
  return usesOrderFile(cfg) && ctx.buildkite;
}

/**
 * An eligible build inherited nothing and is shipping unordered: no recent build of the main branch published
 * this target's order file, so its `-trace-order` step is failing or missing.
 */
export function reportNothingToInherit(cfg: Config): void {
  const msg =
    `${orderFileArtifact(cfg)}: no recent build of the main branch published it, so this build links unordered. ` +
    `The target's trace-order step publishes it after each main build; that step is failing or missing.`;
  console.log(`~ symbol order: ${msg}`);
  if (!isBuildkite) return;
  reportAnnotationToBuildkite({
    // Not an error: the build is fine and its binary correct, only fatter in resident pages.
    style: "warning",
    priority: 5,
    label: "symbol order file",
    content: formatAnnotationToHtml({
      filename: "scripts/build/ci.ts",
      title: "symbol order file: nothing to inherit, shipping unordered",
      content: msg,
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
