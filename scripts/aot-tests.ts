/**
 * Which tests of the ahead-of-time compiler each step of CI runs. .buildkite/ci.ts writes the steps from it, scripts/runner.node.ts
 * picks the files with it, and test/aot/every-test-runs-in-ci.test.ts checks that every test runs in some step.
 * test/aot/README.md, "What CI has to know".
 */
import { createHash } from "node:crypto";
import { aotTests, getCommit } from "./buildkite.ts";

export interface AotLane {
  os: string;
  arch: string;
  abi?: string | undefined;
  distro?: string | undefined;
  profile?: string | undefined;
  tier?: string | undefined;
}

// test/aot costs several times the rest of test/, so it has steps of its own.
export type AotTests = "all" | "a tenth";
// They come in two steps. "fixed" is the same on every commit and may hold up a merge. "drawn" is a sample, files and shares of programs alike, and what it finds is seen and holds up
// nothing.
export type AotTakes = "fixed" | "drawn";

// What the sample goes by: the commit under test. Each commit takes other files and programs, so in time every lane has run all of them. A step is written with its sample, so a retry
// of a job makes the same draw. AOT_SAMPLE is a sample by hand: with the one that a step printed, the steps are those of that commit.
const sampleWithoutCommit = "58b3677a4d38b2500927f51f945beb4c1a01886a";
const isRevision = (text: string | undefined): text is string => /^[0-9a-f]{7,40}$/.test(text ?? "");
let aotSample: string | undefined;
export const getAotSample = (): string =>
  (aotSample ??= [process.env.AOT_SAMPLE, getCommit()].find(isRevision) ?? sampleWithoutCommit);

// Each lane takes another share of the sample: of what is dealt out one in n, the lane with the number k takes the share k % n.
// macOS on ARM64 runs the even half of the files. The four lanes that run one file in eight run the odd eighths, so every file runs on one of the five. macOS on x64 runs an odd tenth and
// Windows on ARM64 an even one: what the other lane of that system does not run. No two lanes take the same tenth of a folder of programs.
export const aotLanes: (AotLane & { share: number })[] = [
  { os: "linux", arch: "x64", distro: "debian", share: 0 },
  { os: "windows", arch: "x64", share: 1 },
  { os: "darwin", arch: "aarch64", share: 2 },
  { os: "linux", arch: "x64", abi: "musl", distro: "alpine", share: 3 },
  { os: "windows", arch: "aarch64", share: 4 },
  { os: "linux", arch: "aarch64", abi: "musl", distro: "alpine", share: 5 },
  { os: "linux", arch: "aarch64", distro: "debian", share: 6 },
  { os: "linux", arch: "x64", distro: "debian", profile: "asan", share: 7 },
  { os: "darwin", arch: "x64", share: 9 },
];

export function getAotShare({ os, arch, abi, profile }: AotLane): number {
  const lane = aotLanes.find(
    lane => lane.os === os && lane.arch === arch && lane.abi === abi && lane.profile === profile,
  );
  if (!lane)
    throw new Error(
      `Unknown lane: ${os} ${arch} ${abi ?? ""} ${profile ?? ""}. Add it to aotLanes in scripts/aot-tests.ts`,
    );
  return lane.share;
}

/** `--aot-sample` and AOT_SHARE: the sample, and the number of the share if it is not the first. */
export const spellSample = (sample: string, share: number) => (share ? `${sample}+${share}` : sample);
export function parseSample(spelled: string): { sample: string; share: number } {
  const [sample = "", share] = spelled.split("+");
  return { sample, share: Number(share) || 0 };
}

const linuxX64AotGroups = ["aot/collector-stress/", "aot/bad-time/", "aot/instruction-counts/"];
const tooSlowForAsan = ["aot/frameworks/nuxt.test", "aot/frameworks/astro.test", "aot/frameworks/angular"];
const fullRunAotGroups = [...linuxX64AotGroups, "aot/heat/", "aot/startup-scaling/", "aot/variant-"];
// What holds up a change of the modules in JavaScript and the schemas of native functions alone: the table against what the functions do, the servers, and the programs of every run.
const libraryAotGroups = ["aot/builtins/", "aot/servers/", "aot/programs-in-every-run"];

// Debian on x64 runs every file, and a file that runs no test there fails (--must-run). What can run none there is listed here: every other step leaves it out, and the step that fits
// always runs it.
/** Every test of these skips itself without a sanitizer or assertions. */
const testsWithSanitizer = [
  "aot/address-sanitizer-",
  "aot/no-leak-records-at-exit",
  "aot/builtins/native-contract-in-parts",
  "aot/engine-tests-in-parts",
];
/** Every test of these skips itself unless Bun was built with --hardened=on. */
const testsOfHardenedBun = [
  "aot/a-hardened-build",
  "aot/executable-memory-filter",
  "aot/hardened-crash-report",
  "aot/hardened-layout",
  "aot/hardened-mappings",
  "aot/hardened-personality",
  "aot/hardened-start",
];
/** These skip themselves when they are run whole. CI runs them as units of test/aot/parts.mts. */
export const testsThatComeInParts = [
  "aot/backend/backend.test",
  "aot/perf/idioms.test",
  "aot/servers/api.test",
  "aot/servers/budgets.test",
  "aot/servers/effect.test",
  "aot/servers/every-pass-changes-a-real-program.test",
  "aot/servers/features.test",
  "aot/servers/schedules.test",
  "aot/servers/servers.test",
];
/** These read the engine's sources, which no test machine has. .github/workflows/lint.yml runs them. */
export const testsOfEngineSources = [
  "aot/a-switch-of-the-compiler-names-every-enumerator.test",
  "aot/emitters-append-in-the-order-written.test",
  "aot/engine-types-are-defined-once.test",
  "aot/every-field-of-flows-results-is-written-and-read.test",
  "aot/every-threshold-of-the-compiler-is-declared-as-one.test",
  "aot/flow-results-name-the-list-they-read.test",
  "aot/lists-of-operations-in-the-compiler-only-shrink.test",
  "aot/one-text-of-the-engine-reads-what-a-descriptor-literal-says.test",
  "aot/the-compiler-reads-no-environment-variable.test",
  "aot/the-compiler-sorts-with-its-own-sort.test",
  "aot/the-frame-of-an-operation-outlives-whoever-is-handed-its-address.test",
  "aot/the-value-under-a-chain-of-casts-is-only-asked-about.test",
  "aot/what-is-only-expected-of-a-position-is-widened-in-one-place.test",
  "aot/what-states-that-nothing-was-thrown-puts-the-end-of-a-worker-off.test",
];
/** No step of CI can run these, and why. They are run by hand. */
export const testsOutsideCi: Record<string, string> = {
  "aot/a-table-of-new-objects-in-hot-code-builds.test":
    "its build takes 7 GB, and a test machine has less than the 12 GB that it asks for",
  "aot/backend/tracker/tracker.test": "it needs a PostgreSQL role that may create databases",
  "aot/packed-relocations.test": "it needs a Bun linked with packed relocations, which no lane builds",
  "aot/paired-returns.test": "it needs ARM64 and a script that lies in the engine's sources",
  "aot/perf/front-end.test":
    "it records every instruction of a server and compares counts that are pinned for one machine",
  "aot/perf/more-knowledge-costs-no-site.test": "it makes hundreds of builds",
  "aot/real-apps/real-apps.test": "it clones open-source projects and runs their tests, up to an hour each",
  "aot/thread-sanitizer.test": "it needs the engine's tests built with ThreadSanitizer, which no lane builds",
  "aot/web-assembly-left-out-of-the-build.test": "it needs a Bun built without WebAssembly, which no lane builds",
};

export function getAotTestsOfLane(
  { os, arch, distro, profile, tier }: AotLane,
  hasAotChanges: boolean,
): AotTests | undefined {
  if (distro === "ubuntu" || tier === "beta") return undefined;
  if (!hasAotChanges) return distro === "debian" && !profile ? "a tenth" : undefined;
  return (os === "darwin" && arch === "x64") || (os === "windows" && arch === "aarch64") ? "a tenth" : "all";
}

export function getAotExcludes({ arch, distro, profile }: AotLane, aot: AotTests): string[] {
  const groups = aot === "a tenth" ? fullRunAotGroups : linuxX64AotGroups;
  const runNothing = [
    ...testsOfHardenedBun,
    ...testsThatComeInParts,
    ...testsOfEngineSources,
    ...Object.keys(testsOutsideCi),
  ];
  if (profile === "asan") return [...groups, ...tooSlowForAsan, ...runNothing];
  runNothing.push(...testsWithSanitizer);
  return aot === "all" && arch === "x64" && distro === "debian" ? runNothing : [...groups, ...runNothing];
}

// Debian runs every file. Any other lane runs one file in this many.
export function getAotFileDraw({ os, distro, profile }: AotLane, aot: AotTests): number {
  if (aot === "a tenth") return 10;
  if (distro === "debian" && !profile) return 1;
  return os === "darwin" ? 2 : 8;
}

// What a lane runs whatever it draws.
export function getAotAlwaysDrawn(
  { os, arch, profile }: AotLane,
  hasLibraryChangesWithoutAotChanges: boolean,
): string[] {
  const isMacOnArm = os === "darwin" && arch === "aarch64";
  return [
    ...(hasLibraryChangesWithoutAotChanges ? libraryAotGroups : []),
    // The engine's own CI tests Linux alone: nothing else runs its tests on macOS.
    ...(isMacOnArm ? ["aot/engine-tests"] : []),
    ...(profile === "asan" ? ["aot/exception-checks"] : []),
    // Most files skip themselves where a Bun has no compiler. This one never does.
    "aot/every-platform",
    // What can refuse to start an executable is tested wherever one is started.
    "aot/an-executable-whose-image-header-names-a-range-outside-its-code-segment-does-not-start",
    "aot/compiled-code-mapping",
    "aot/inserted-library",
    "aot/ways-to-start-an-executable",
    // Each system has its own way to refuse a process memory for generated code.
    "aot/without-executable-memory",
    // Each system has its own way to take a wish for an address.
    "aot/every-launch-places-its-heap-anew",
    // Each system has its own way to tell a process its time zone, and its own folders above a temporary one.
    "aot/time-zone-at-start",
    "aot/plain-bun-installs-no-packages",
    // Only on this CPU is the reach of a call within the size of a large program.
    ...(arch === "aarch64" ? ["aot/calls-beyond-their-reach"] : []),
    // Only a file system that ignores the case of letters can tell it from any other resolution.
    ...(os === "darwin" ? ["aot/resolver/file-name-case"] : []),
    // It lists what once went wrong on one platform alone, so that no draw passes it over there.
    "aot/programs-that-differed-on-one-platform",
    // What every run takes of the programs, whatever its share. Debian runs every file.
    ...(profile === "asan" || isMacOnArm ? ["aot/programs-in-every-run"] : []),
    // Each HTTP server answers every route.
    ...(isMacOnArm ? ["aot/servers/"] : []),
    // A library is files in folders, and every platform spells a path its own way.
    "bundler/bun-build-api-dts",
    "bundler/bun-build-dts",
    "cli/compile/compile-library",
    "aot/aot-package-compiler-options",
  ];
}

// The tests whose next result on a system is waited for. The lanes of that system run them on every commit, whatever they draw. An entry is taken out when the result is in.
export const testsAwaitedOn: Record<string, string[]> = {
  windows: [
    "aot/a-descriptor-that-is-written-out-is-no-object-whatever-it-describes-a-property-of",
    "aot/a-field-that-holds-undefined-outside-the-cell-fails-no-test",
    "aot/asking-about-a-class-keeps-none-of-its-code",
    "aot/compact-code-avoids-runtime",
    "aot/engine-tests-ir",
    "aot/engine-tests-native",
    "aot/every-program-28.",
    "aot/function-prototypes.",
    "aot/minifying-first-saves-no-code-12.",
    "aot/one-line-changes-little-1.",
    "aot/pointers-into-what-a-cell-owns",
    "aot/programs-in-every-run-13.",
    "aot/programs-in-every-run-23.",
    "aot/programs-in-every-run-27.",
    "aot/programs-in-every-run-37.",
    "aot/programs-in-every-run-44.",
    "aot/programs-in-every-run-60.",
    "aot/runtime-counts-file",
    "aot/wide-prototype-objects-cost-what-narrow-ones-cost",
    "bundler/compile-trim-remove",
  ],
};

// What the step that holds up nothing runs whatever the lane draws.
export function getAotAlwaysInDrawnStep({ os, profile }: AotLane, aot: AotTests): string[] {
  return [
    ...(testsAwaitedOn[os] ?? []),
    // A mark for this lane alone can only be found stale on this lane.
    ...(aot === "all" ? ["aot/programs-marked-as-failing"] : []),
    // They go to the other step once they have been green here.
    ...(profile === "asan" ? testsWithSanitizer : []),
    // One test of the first is for this system, and the file system ignores the case of letters. They go to the other step once they have been green here.
    ...(os === "windows" ? ["aot/engine-tests.test", "aot/resolver/file-name-case"] : []),
  ];
}

/** What scripts/runner.node.ts is told for a step of `lane`. */
export function getAotStepArguments(
  lane: AotLane,
  aot: AotTests,
  takes: AotTakes,
  hasLibraryChangesWithoutAotChanges: boolean,
): string[] {
  const draw = getAotFileDraw(lane, aot);
  const alwaysDrawn = getAotAlwaysDrawn(lane, hasLibraryChangesWithoutAotChanges);
  const args: string[] = [];
  if (draw === 1) args.push(...aotTests.map(group => `--include=${group}`), `--aot-takes=${takes}`);
  else if (takes === "fixed") args.push(...alwaysDrawn.map(group => `--include=${group}`), "--aot-takes=fixed");
  else {
    args.push(
      ...aotTests.map(group => `--include=${group}`),
      `--one-in=${draw}`,
      ...alwaysDrawn.map(group => `--exclude=${group}`),
    );
    args.push(...getAotAlwaysInDrawnStep(lane, aot).map(group => `--always-draw=${group}`));
  }
  if (takes === "drawn") args.push(`--aot-sample=${spellSample(getAotSample(), getAotShare(lane))}`);
  args.push(...getAotExcludes(lane, aot).map(group => `--exclude=${group}`));
  if (draw === 1 && lane.arch === "x64") args.push(...aotTests.map(group => `--must-run=${group}`));
  else if (lane.profile === "asan" && takes === "drawn")
    args.push(...testsWithSanitizer.map(group => `--must-run=${group}`));
  return args;
}

/** What it is told for a step that has a Bun built with --hardened=on. */
export const getHardenedStepArguments = (takes: AotTakes) => [
  ...(takes === "fixed"
    ? [
        "--include=aot/hardened",
        "--include=aot/a-hardened-build",
        "--include=aot/an-executable-that-cannot-read-its-own-file",
        "--include=aot/compiled-code-mapping",
        "--include=aot/texts-that-tell-builds-apart",
      ]
    : // It goes to the other step once it has been green here.
      ["--include=aot/executable-memory-filter"]),
  ...testsOfHardenedBun.map(group => `--must-run=${group}`),
];

const spell = (path: string) => path.replaceAll("\\", "/");

/** Whether the lane of `spelledSample` runs the test at `path`, a path under test/, where a lane runs one in `oneIn`. */
export function isFileDrawn(spelledSample: string, path: string, oneIn: number): boolean {
  const { sample, share } = parseSample(spelledSample);
  return (
    createHash("sha1")
      .update(`${sample} ${spell(path)}`)
      .digest()
      .readUInt32LE(0) %
      oneIn ===
    share % oneIn
  );
}

export interface StepArguments {
  include: string[];
  exclude: string[];
  takes?: string | undefined;
  oneIn: number;
  sample: string;
  alwaysDraw: string[];
  mustRun: string[];
}

export function parseStepArguments(args: string[]): StepArguments {
  const all = (name: string) => args.filter(arg => arg.startsWith(`--${name}=`)).map(arg => arg.slice(name.length + 3));
  return {
    include: all("include"),
    exclude: all("exclude"),
    takes: all("aot-takes")[0],
    oneIn: Number(all("one-in")[0] ?? 1),
    sample: all("aot-sample")[0] ?? "",
    alwaysDraw: all("always-draw"),
    mustRun: all("must-run"),
  };
}

/** `--aot-takes`: those of `tests` that have something for the step. */
export function pickTestsWithSomethingFor(takes: string, tests: string[], kind: KindOfTest): string[] {
  return tests.filter(path => (takes === "drawn" ? kind.draws(path) : !kind.onlyDraws(path)));
}

/** `--one-in`: those of `tests` that the lane draws, and those of `alwaysDraw`. */
export function pickDrawnTests(
  { oneIn, sample, alwaysDraw }: Pick<StepArguments, "oneIn" | "sample" | "alwaysDraw">,
  tests: string[],
): string[] {
  return tests.filter(
    path => isFileDrawn(sample, path, oneIn) || alwaysDraw.some(group => spell(path).includes(group)),
  );
}

interface KindOfTest {
  draws(path: string): boolean;
  onlyDraws(path: string): boolean;
}

/** The tests that a step with these arguments runs, of `tests`, which are paths under test/. */
export function pickTestsOfStep(step: StepArguments, tests: string[], kind: KindOfTest): string[] {
  let picked = tests.filter(path => step.include.some(group => spell(path).includes(group)));
  picked = picked.filter(path => !step.exclude.some(group => spell(path).includes(group)));
  if (step.takes) picked = pickTestsWithSomethingFor(step.takes, picked, kind);
  return step.oneIn > 1 ? pickDrawnTests(step, picked) : picked;
}

/**
 * `--must-run`: whether the test at `path` fails if it runs no test. Where there are two steps, a test that draws may have nothing for the step that is fixed, and only one that has
 * nothing for that step is sure to have something for the other.
 */
export function mustRunSomething(
  { mustRun, takes }: Pick<StepArguments, "mustRun" | "takes">,
  path: string,
  kind: KindOfTest,
): boolean {
  if (!mustRun.some(group => spell(path).includes(group))) return false;
  return takes === "fixed" ? !kind.draws(path) : takes === "drawn" ? kind.onlyDraws(path) : true;
}
