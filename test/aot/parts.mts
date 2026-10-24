// What CI runs as a test file of its own without a file for it. scripts/runner.node.ts lists `units` beside the test files that it finds, under the names they have here, and runs
// test/aot/parts.test.ts for each with the name in TEST_PART. By hand:
//
//   TEST_PART=aot/structural-types-7 bun test test/aot/parts.test.ts     one part
//   TEST_PART=aot/structural-types bun test test/aot/parts.test.ts       all its parts
//   TEST_PART=bundler/compile-trim-runtime-by-use.test.ts ..             the unit of that name alone, as the runner asks for it
//   TEST_PART=all bun test test/aot/parts.test.ts                        everything
//
// A part that takes more than three minutes in CI: raise the number of parts.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * `name`, a path under test/, is run in `parts` parts called `<name>-<part>`: `callee` of `module` is called with `before`, the part from 1, the number of parts and what `behind`
 * has for that part. Where `parts` is 0 there is one unit, `name`, and the call has `before` alone. Rows of one name are run together.
 */
export type Row = [name: string, parts: number, module: string, callee: string, before?: unknown[], behind?: unknown[][] | undefined];

const here = import.meta.dirname;
const foldersIn = (folder: string) =>
  readdirSync(join(here, folder), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

/** Every folder of ./programs is run. These are in parts, or are written whole by a script of ./generate.ts and lie nowhere. */
const programFolders: Record<string, number> = {
  "awaited-objects": 0,
  "built-ins-alone": 108,
  "built-ins-asked-in-place": 0,
  "calls": 2,
  "classes-below-built-in-classes": 8,
  "copies-born-in-their-holders": 0,
  "counterexamples": 3,
  "data-from-outside": 2,
  "impostors": 20,
  "kept-attacks": 6,
  "language": 2,
  "method-table": 4,
  "native-callbacks": 0,
  "relations-at-random": 0,
  "static-modules": 2,
  "strings": 2,
  "structural-types": 32,
  "typed-objects": 3,
  "untyped-code": 3,
  "untyped-stress": 2,
  "ways-into-library-modules": 8,
  "writes-to-host-objects": 7,
};

/** Every file of ./packages but the runner holds cases. These are in parts. */
const packageParts: Record<string, number> = {
  "commonjs-interop": 3,
  "export-styles": 4,
  "exports-conditions": 3,
  "main-field": 2,
  "patching-globals": 2,
  "wrong-declarations": 2,
};

const besideTheProgram = {
  BUN_JSC_collectContinuously: "1",
  BUN_JSC_collectContinuouslyPeriodMS: "1",
  BUN_JSC_useZombieMode: "1",
  BUN_JSC_scribbleFreeCells: "1",
};
const withoutInlining = "--aot-disable=InlineCalls";
// One distance between collections is blind to what another shows, and only young collections show a store without its barrier.
const collecting = (every: number, young: boolean) => ({
  BUN_JSC_slowPathAllocsBetweenGCs: String(every),
  BUN_JSC_useZombieMode: "1",
  BUN_JSC_scribbleFreeCells: "1",
  ...(young ? { BUN_JSC_useEdenCollectionsAtSlowPathAllocs: "1" } : {}),
});
const underCollections = { BUN_JSC_slowPathAllocsBetweenGCs: "3", BUN_JSC_scribbleFreeCells: "1" };

const variant = (label: string, flags: string[], env: object = {}, parts = 3, behind?: unknown[][]): Row => [
  `aot/variant-${label}`,
  parts,
  "./run-programs",
  "variant",
  [label, flags, env],
  behind,
];
const builtWith = (folder: string, label: string, flags: string[], env = {}, parts = 0): Row => [
  `aot/${folder}-${label}`,
  parts,
  "./run-programs",
  "programsBuiltWith",
  [folder, label, flags, env],
];
const births = (title: string, file = title.replaceAll(" ", "-"), isTyped?: boolean, parts = 0): Row => [
  `aot/generated-births-and-uses-of-${title.replaceAll(" ", "-")}`,
  parts,
  "./generated/births-and-uses/run",
  "birthsAndUses",
  [title, file, isTyped],
];

export const rows: Row[] = [
  ...[...new Set([...foldersIn("programs"), ...Object.keys(programFolders)])]
    // A folder that is also built in other ways may have a test file of its own.
    .filter(folder => !existsSync(join(here, `${folder}.test.ts`)))
    .map((folder): Row => [`aot/${folder}`, programFolders[folder] ?? 0, "./run-programs", "programs", [folder]]),
  ...readdirSync(join(here, "packages"))
    .filter(file => file.endsWith(".ts") && file !== "run-packages.ts")
    .map(file => file.slice(0, -".ts".length))
    .map((topic): Row => [`aot/packages-${topic}`, packageParts[topic] ?? 0, "./packages/run-packages", "packages", [topic]]),
  ...foldersIn("frameworks/apps").flatMap((name): Row[] => [
    [`aot/frameworks/${name}`, 0, "./frameworks/run-framework", "testFramework", [name]],
    [`aot/frameworks/${name}-one-file`, 0, "./frameworks/run-framework", "testFramework", [name, "one file"]],
  ]),

  variant("all-code-direct", ["--aot-testing=GenerateAllCodeDirectly"]),
  variant("cold-code-direct", ["--aot-limit=MaxWarmCodeValues:1", "--aot-testing=GenerateColdCodeDirectly"]),
  variant("collecting-beside-the-program", [], besideTheProgram),
  variant(
    "collections-at-allocations",
    [],
    [{ BUN_JSC_forceFencedBarrier: "1" }, ...[5, 3, 2, 1].map(every => collecting(every, true)), ...[7, 3, 2, 1].map(every => collecting(every, false))],
    3,
    [[["async-and-generators/awaited-steps-that-wait-or-do-not"], undefined, true], [[], undefined, true], [[], undefined, true]],
  ),
  variant("every-function-cold", ["--aot-heat=everything-is-cold"]),
  variant("every-function-hot", ["--aot-heat=everything-is-hot"]),
  variant("every-function-neither-hot-nor-cold", ["--aot-heat=nothing-is-hottest"]),
  variant("flow-fixpoint", ["--aot-check=flow-fixpoint"]),
  variant("full-collections-beside-the-program", [], { ...besideTheProgram, BUN_JSC_useGenerationalGC: "0" }),
  variant("inner-objects-flattened-wherever-legal", ["--aot-testing=FlattenUntilHeldWhereverLegal"]),
  variant("no-flow-results", ["--aot-disable=flow-results"]),
  variant("no-inlining", [withoutInlining]),
  variant("predictions-fail-every-time", ["--aot-testing=FailPredictions"]),
  variant("predictions-fail-half-the-time", ["--aot-testing=FailPredictions:2:1"]),
  variant(
    "predictions-fail-half-the-time-under-collections",
    ["--aot-testing=FailPredictions:2:2"],
    [...[5, 2, 1].map(every => collecting(every, true)), ...[7, 3].map(every => collecting(every, false))],
  ),
  variant("predictions-fail-one-time-in-seven", ["--aot-testing=FailPredictions:7:1"]),
  variant("predictions-fail-one-time-in-seven-validated", ["--aot-testing=FailPredictions:7:2", "--aot-validate"]),
  variant("program-is-very-large", ["--aot-limit=MaxWarmCodeValues:1"]),
  variant("proofs-checked-at-run-time", ["--aot-testing=CheckProofsAtRunTime"]),
  variant("stub-copies", [], {}, 3, [
    ["async-and-generators/what-an-async-generator-throws-reaches-the-catch-around-the-loop", 3],
    ["calls/calls-with-lists-of-arguments-in-tail-position-keep-the-stack-level", 3],
    ["", 3],
  ]),
  variant("validate", ["--aot-validate"], {}, 3, [[], [], ["narrowing/members-changed-behind-the-checker"]]),
  variant("validate-back-end", ["--aot-check=validate-back-end"], {}, 8),
  variant("validate-collecting", ["--aot-validate"], {
    BUN_JSC_slowPathAllocsBetweenGCs: "1",
    BUN_JSC_useZombieMode: "1",
    BUN_JSC_scribbleFreeCells: "1",
    BUN_JSC_numberOfGCMarkers: "1",
    BUN_JSC_useConcurrentGC: "0",
  }),
  variant("veneers", ["--aot-limit=function-call-reach:0"]),
  variant("verified-collections", [], { BUN_JSC_verifyGC: "1" }),
  variant("verify-each-pass", ["--aot-check=verify-each-pass"], {}, 6, [
    [
      [
        "definitions-by-descriptor/descriptors-that-leave-the-getter-out-beside-descriptors-that-hold-one",
        "escape-analysis/a-closure-of-an-async-function-that-nobody-calls",
        "function-prototypes/a-constructor-function-that-is-only-called-with-the-objects-of-others",
        "structural-types/a-spread-of-a-text-an-array-or-an-instance-of-other-classes",
      ],
    ],
  ]),
  variant("wide-references", ["--aot-huge-heap"]),
  variant("wide-references-outside-the-reserved-range", ["--aot-huge-heap"], { BUN_JSC_markedBlockCageSizeInMB: "1" }),
  // Each part is built with a switch of its own.
  ...["DelayFlowRules", "DelayOtherFlowRules", "DelayFlowRules,DelayOtherFlowRules"].map(
    (rules, index): Row => [
      `aot/variant-flow-rules-delayed-${index + 1}`,
      0,
      "./run-programs",
      "variant",
      ["flow-rules-delayed", [`--aot-testing=${rules}`], {}, index + 1, 3],
    ],
  ),
  ["aot/variant-trimmed-runtime", 3, "./run-programs", "variantWithTrimmedRuntime"],
  ["aot/variant-without-flow-result", 8, "./flow-result-kinds", "variantsWithoutOneFlowResult"],

  builtWith("built-ins-asked-in-place", "validated", ["--aot-validate"]),
  builtWith("kept-attacks", "validated", ["--aot-validate"], {}, 4),
  builtWith("relational-summaries", "collector-verifies", ["--aot-validate"], { BUN_JSC_verifyGC: "1" }),
  builtWith("relational-summaries", "under-collections", [withoutInlining], underCollections),
  builtWith("relational-summaries", "validated", ["--aot-validate", withoutInlining]),
  builtWith("relational-summaries", "without-inlining", [withoutInlining]),
  builtWith("relations-at-random", "under-collections", [withoutInlining], underCollections),
  builtWith("relations-at-random", "without-inlining", ["--aot-validate", withoutInlining]),
  builtWith("site-records", "every-function-cold", ["--aot-heat=everything-is-cold"]),
  builtWith("site-records", "every-function-cold-types-erased", ["--aot-heat=everything-is-cold", "--aot-erase-types"]),

  births("arrays", "arrays", false),
  births("arrays whose storage is proven"),
  births("awaited values", "awaited-values", false),
  births("callables", "callables", false),
  births("classes whose parent is replaced", undefined, undefined, 3),
  births("collections filled from what a hot function is given"),
  births("host functions", "host-functions", false),
  births("maps and sets", "maps-and-sets", false),
  births("objects", "objects", false),
  births("objects constructed below another prototype", "constructed-below-another-prototype"),
  births("objects held as a class", "held-as-a-class", undefined, 2),
  births("objects held as a kind that never comes"),
  births("objects held as a kind that never comes and read through any"),
  births("objects held in a variable that no instance reaches", "held-in-a-variable-that-no-instance-reaches"),
  births("objects written into by a built-in", "written-into-by-a-built-in", false),
  births("one use of two kinds of value", undefined, undefined, 6),
  births("one walk of two kinds of collection"),
  births("promises of natives that reject", "promises-of-natives-that-reject", false),
  births("steps of an async generator"),
  births("stores behind every way to wait"),
  births("stores of two takers of one source", undefined, undefined, 5),
  births("stretches that differ in one thing"),
  births("strings", "strings", false),
  births("two kinds of list or collection at one use", undefined, undefined, 4),
  births("two kinds of object at one place", undefined, false),
  births("two kinds of object held as the first"),
  births("two kinds of object held as the first and read through any"),
  births("two kinds of object read through any"),
  births("typed arrays", "arrays", true),
  births("typed objects", "objects", true),
  births("typed objects written into by a built-in", "written-into-by-a-built-in", true),
  births("typed one use of two kinds of value", "one-use-of-two-kinds-of-value", true, 4),
  births("typed promises of natives that reject", "promises-of-natives-that-reject", true),
  births("typed strings", "strings", true),
  births("typed two kinds of list or collection at one use", "two-kinds-of-list-or-collection-at-one-use", true, 4),
  births("typed two kinds of object at one place", "two-kinds-of-object-at-one-place", true),
  births("typed what is made anew on every turn", "made-anew-on-every-turn", true),
  births("values handed out by iterators", undefined, undefined, 3),
  births("what is made anew on every turn", "made-anew-on-every-turn", false),

  ["aot/backend-packages/more-programs", 0, "./backend-packages/each-program", "testMorePrograms"],
  ["aot/backend-packages/programs", 4, "./backend-packages/each-program", "testPrograms"],
  ["aot/backend-packages/programs-one-file", 0, "./backend-packages/each-program", "testPrograms", [1, 1, "one file"]],
  ["aot/bad-time/bad-time", 8, "./bad-time/run-bad-time", "badTime"],
  ["aot/builtins/differential", 4, "./builtins/differential-cases", "differential"],
  ["aot/collector-stress/full", 30, "./collector-stress/run-collector-stress", "collectorStress", ["full"]],
  ["aot/collector-stress/young", 20, "./collector-stress/run-collector-stress", "collectorStress", ["young"]],
  ["aot/compile-exec-argv-as-without-aot", 3, "./compile-exec-argv-as-without-aot-cases", "execArgvAsWithoutAot"],
  ["aot/each-case-alone", 20, "./each-case-alone-cases", "eachCaseAlone"],
  ["aot/generated-cases-three-ways", 8, "./three-ways/made-cases", "madeCasesOfAllTopics"],
  ["aot/generated-fresh-seeds", 3, "./generated/fresh-seeds", "freshSeeds"],
  ["aot/global-names", 3, "./global-names-cases", "globalNames"],
  ["aot/heat/cold", 8, "./heat/run-heat", "heat", ["cold"]],
  ["aot/heat/hot", 8, "./heat/run-heat", "heat", ["hot"]],
  ["aot/heat/neither", 8, "./heat/run-heat", "heat", ["neither"]],
  ["aot/jit-mode-eager-tier-up", 2, "./jit-mode-eager-tier-up", "eagerTierUpSweep"],
  [
    "aot/joined-programs-all-code-direct",
    3,
    "./joined-programs",
    "joined",
    ["all-code-direct", ["--aot-testing=GenerateAllCodeDirectly"]],
  ],
  [
    "aot/joined-programs-predictions-fail",
    12,
    "./joined-programs",
    "joined",
    ["predictions-fail", ["--aot-testing=FailPredictions:2:1"]],
  ],
  // A group of 250 programs costs about one build, so these take fifty times the programs of variant-validate and variant-proofs-checked-at-run-time.
  ["aot/joined-programs-proofs-checked", 3, "./joined-programs", "joined", ["proofs-checked", ["--aot-testing=CheckProofsAtRunTime"]]],
  ["aot/joined-programs-validated", 4, "./joined-programs", "joined", ["validated", ["--aot-validate"]]],
  ["aot/modules-three-ways", 4, "./three-ways/run-three-ways", "threeWays"],
  ["aot/one-line-changes-little", 8, "./one-line-changes-little-cases", "oneLineChangesLittle"],
  ["aot/process-platform-folds", 4, "./process-platform-folds-cases", "processPlatformFolds"],
  [
    "aot/programs-that-stopped-a-validating-build",
    3,
    "./programs-that-stopped-a-validating-build-cases",
    "programsThatStoppedAValidatingBuild",
  ],
  ["aot/roads-to-members-of-the-runtime", 4, "./roads-to-members-of-the-runtime-cases", "roadsTo"],
  ["aot/run-aot-frozen-arrays", 3, "./run-aot-frozen-arrays", "frozenArrayTests"],
  ["aot/runtime-use", 4, "./runtime-use-cases", "runtimeUseTests"],
  ["aot/runtime-use-hosts", 3, "./runtime-use-hosts-cases", "runtimeUseOfHostsTests"],
  ["aot/startup-scaling/startup-scaling", 4, "./startup-scaling/startup-scaling", "describePart"],
  ["aot/trimmed-against-whole", 4, "./trimmed-against-whole-cases", "trimmedAgainstWhole"],
  ["aot/trimmed-matches-untrimmed", 4, "./trimmed-is-whole/run", "testTrimmedMatchesUntrimmed"],

  ["bundler/compile-trim-never-exits", 0, "../bundler/compile-trim-never-exits-run", "testRemovedFeaturesNeverExit", ["plain"]],
  ["bundler/compile-trim-never-exits-aot", 0, "../bundler/compile-trim-never-exits-run", "testRemovedFeaturesNeverExit", ["aot"]],
  ["bundler/compile-trim-runtime-by-use", 0, "../bundler/compile-trim-runtime-by-use-run", "testDeal"],
  ["bundler/compile-trim-runtime-by-use", 16, "../bundler/compile-trim-runtime-by-use-run", "testPrograms"],
  ["bundler/compile-trim-runtime-by-use-features", 4, "../bundler/compile-trim-runtime-by-use-run", "testFeatures"],
  ["bundler/compile-trim-runtime-options", 0, "../bundler/compile-trim-runtime-options-run", "testTheSorting"],
  ["bundler/compile-trim-runtime-options", 0, "../bundler/compile-trim-runtime-options-run", "testBunOptions"],
  ["bundler/compile-trim-runtime-options-exec-argv", 10, "../bundler/compile-trim-runtime-options-run", "testExecArgv"],
  ["bundler/trim-runtime-icu/every-locale", 0, "../bundler/trim-runtime-icu/every-locale-run", "testDeal"],
  ["bundler/trim-runtime-icu/every-locale", 4, "../bundler/trim-runtime-icu/every-locale-run", "testPrograms"],
];

/** The names of a row's units. */
export const unitsOf = ([name, parts]: Row) =>
  parts ? Array.from({ length: parts }, (_, index) => `${name}-${index + 1}`) : [name];

/** As paths under test/. */
export const units = [...new Set(rows.flatMap(unitsOf))].map(name => `${name}.test.ts`);
