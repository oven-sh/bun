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
  "code-that-built-ins-run": 8,
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

  variant("claims-checked-at-run-time", ["--aot-check=ClaimsToBackEnd"]),
  variant("collecting-beside-the-program", [], besideTheProgram),
  variant(
    "collections-at-allocations",
    [],
    [{ BUN_JSC_forceFencedBarrier: "1" }, ...[5, 3, 2, 1].map(every => collecting(every, true)), ...[7, 3, 2, 1].map(every => collecting(every, false))],
    3,
    [[["async-and-generators/awaited-steps-that-wait-or-do-not"]]],
  ),
  // Every allocation of compiled code leaves the fast path, so a collection falls at each of them and not only where a block is used up.
  variant(
    "collections-at-every-allocation",
    ["--aot-testing=ForceGCSlowPaths"],
    [...[7, 3, 1].map(every => collecting(every, true)), ...[3, 1].map(every => collecting(every, false))],
    6,
    [[["collector/flags-kept-out-of-line-are-read-by-the-last-holder-of-their-object-in-a-loop-that-makes-texts"]]],
  ),
  variant("every-function-cold", ["--aot-heat=everything-is-cold"]),
  variant("every-function-hot", ["--aot-heat=everything-is-hot"]),
  variant("every-function-neither-hot-nor-cold", ["--aot-heat=nothing-is-hottest"]),
  variant("flow-fixpoint", ["--aot-check=flow-fixpoint"]),
  variant("full-collections-beside-the-program", [], { ...besideTheProgram, BUN_JSC_useGenerationalGC: "0" }),
  variant("moved-loads-checked-at-run-time", ["--aot-check=MovedLoads"]),
  variant("no-flow-results", ["--aot-disable=flow-results"]),
  variant("no-inlining", [withoutInlining]),
  variant("predictions-fail-every-time", ["--aot-testing=FailPredictions"]),
  variant("predictions-fail-half-the-time", ["--aot-testing=FailPredictions:2:1"], {}, 3, [
    [["host-classes/bodies-parsed-into-declared-types"]],
  ]),
  variant(
    "predictions-fail-half-the-time-under-collections",
    ["--aot-testing=FailPredictions:2:2"],
    [...[5, 2, 1].map(every => collecting(every, true)), ...[7, 3].map(every => collecting(every, false))],
    3,
    [[["inner-objects/objects-with-every-kind-of-slot-are-made-around-calls-that-collect"]]],
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
  // A small program collects about twice by itself. The verifier marks the heap again behind each collection and names a cell that is reachable and was not marked.
  variant("verified-collections", [], [
    { BUN_JSC_verifyGC: "1" },
    { BUN_JSC_verifyGC: "1", BUN_JSC_slowPathAllocsBetweenGCs: "5", BUN_JSC_useEdenCollectionsAtSlowPathAllocs: "1" },
    { BUN_JSC_verifyGC: "1", BUN_JSC_slowPathAllocsBetweenGCs: "7" },
  ]),
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

  births("a value of another kind arrives in the middle of the work", "a-value-of-another-kind-arrives-in-the-middle-of-the-work", false),
  births("arrays", "arrays", false),
  births("arrays whose storage is proven"),
  births("awaited values", "awaited-values", false),
  births("callables", "callables", false),
  births("classes whose parent is replaced", undefined, undefined, 6),
  births("collections filled from what a hot function is given"),
  births("counters near the ends of the whole numbers", "counters-near-the-ends-of-the-whole-numbers", false),
  births("equal stretches that seldom run", "equal-stretches-that-seldom-run", false),
  births("fields that nothing reads by name", "fields-that-nothing-reads-by-name", false),
  births("functions whose last act is to call themselves", "functions-whose-last-act-is-to-call-themselves", false),
  births("generators between their making and their first step", "generators-between-their-making-and-their-first-step", false),
  births("generators walked where they are made", "generators-walked-where-they-are-made", false),
  births("host functions", "host-functions", false),
  births("lists made ahead of the one place that takes them", "lists-made-ahead-of-the-one-place-that-takes-them", false),
  births("lists that grow in loops", "lists-that-grow-in-loops", false),
  births("loops that leave nothing behind", "loops-that-leave-nothing-behind", false),
  births("loops with a way seldom taken", "loops-with-a-way-seldom-taken", false),
  births("maps and sets", "maps-and-sets", false),
  births("objects", "objects", false),
  births("objects constructed below another prototype", "constructed-below-another-prototype"),
  births("objects filled field by field", "objects-filled-field-by-field", false),
  births("objects held as a class", "held-as-a-class", undefined, 2),
  births("objects held as a kind that never comes", undefined, undefined, 3),
  births("objects held as a kind that never comes and read through any", undefined, undefined, 3),
  births("objects held in a variable that no instance reaches", "held-in-a-variable-that-no-instance-reaches"),
  births("objects written into by a built-in", "written-into-by-a-built-in", false),
  births("one class makes the members of a union", "one-class-makes-the-members-of-a-union", false),
  births("one thing under two names", "one-thing-under-two-names", false),
  births("one use of two kinds of value", undefined, undefined, 9),
  births("one walk of two kinds of collection"),
  births("parameters and results that nobody reads", "parameters-and-results-that-nobody-reads", false),
  births("pattern literals met again", "pattern-literals-met-again", false),
  births("promises of natives that reject", "promises-of-natives-that-reject", false, 2),
  births("records written as text", "records-written-as-text", false),
  births("results made for the caller", "results-made-for-the-caller", false),
  births("steps of an async generator"),
  births("stores behind every way to wait"),
  births("stores of two takers of one source", undefined, undefined, 10),
  births("stretches that differ in one thing"),
  births("strings", "strings", false),
  births("texts put together piece by piece", "texts-put-together-piece-by-piece", false),
  births("texts read as records", "texts-read-as-records", false),
  births("the keys of an object are walked", "the-keys-of-an-object-are-walked", false),
  births("two kinds of list or collection at one use", undefined, undefined, 4),
  births("two kinds of object at one place", undefined, false, 2),
  births("two kinds of object held as the first", undefined, undefined, 3),
  births("two kinds of object held as the first and read through any", undefined, undefined, 3),
  births("two kinds of object read through any", undefined, undefined, 3),
  births("two kinds of value at one operator", "two-kinds-of-value-at-one-operator", false),
  births("typed a value of another kind arrives in the middle of the work", "a-value-of-another-kind-arrives-in-the-middle-of-the-work", true),
  births("typed arrays", "arrays", true),
  births("typed counters near the ends of the whole numbers", "counters-near-the-ends-of-the-whole-numbers", true),
  births("typed equal stretches that seldom run", "equal-stretches-that-seldom-run", true),
  births("typed fields that nothing reads by name", "fields-that-nothing-reads-by-name", true),
  births("typed functions whose last act is to call themselves", "functions-whose-last-act-is-to-call-themselves", true),
  births("typed generators between their making and their first step", "generators-between-their-making-and-their-first-step", true),
  births("typed generators walked where they are made", "generators-walked-where-they-are-made", true),
  births("typed lists made ahead of the one place that takes them", "lists-made-ahead-of-the-one-place-that-takes-them", true, 2),
  births("typed lists that grow in loops", "lists-that-grow-in-loops", true),
  births("typed loops that leave nothing behind", "loops-that-leave-nothing-behind", true),
  births("typed loops with a way seldom taken", "loops-with-a-way-seldom-taken", true),
  births("typed objects", "objects", true),
  births("typed objects filled field by field", "objects-filled-field-by-field", true),
  births("typed objects written into by a built-in", "written-into-by-a-built-in", true),
  births("typed one class makes the members of a union", "one-class-makes-the-members-of-a-union", true),
  births("typed one thing under two names", "one-thing-under-two-names", true),
  births("typed one use of two kinds of value", "one-use-of-two-kinds-of-value", true, 4),
  births("typed parameters and results that nobody reads", "parameters-and-results-that-nobody-reads", true),
  births("typed pattern literals met again", "pattern-literals-met-again", true),
  births("typed promises of natives that reject", "promises-of-natives-that-reject", true),
  births("typed records written as text", "records-written-as-text", true),
  births("typed results made for the caller", "results-made-for-the-caller", true),
  births("typed strings", "strings", true),
  births("typed texts put together piece by piece", "texts-put-together-piece-by-piece", true),
  births("typed texts read as records", "texts-read-as-records", true),
  births("typed the keys of an object are walked", "the-keys-of-an-object-are-walked", true),
  births("typed two kinds of list or collection at one use", "two-kinds-of-list-or-collection-at-one-use", true, 4),
  births("typed two kinds of object at one place", "two-kinds-of-object-at-one-place", true, 3),
  births("typed two kinds of value at one operator", "two-kinds-of-value-at-one-operator", true),
  births("typed variables of enclosing code in loops", "variables-of-enclosing-code-in-loops", true),
  births("typed variables that closures hold", "variables-that-closures-hold", true),
  births("typed ways that part and meet", "ways-that-part-and-meet", true),
  births("typed what is made anew on every turn", "made-anew-on-every-turn", true, 2),
  births("typed whole numbers divided", "whole-numbers-divided", true, 2),
  births("typed work done ahead of a test that fails", "work-done-ahead-of-a-test-that-fails", true),
  births("values handed out by iterators", undefined, undefined, 6),
  births("variables of enclosing code in loops", "variables-of-enclosing-code-in-loops", false),
  births("variables that closures hold", "variables-that-closures-hold", false),
  births("ways that part and meet", "ways-that-part-and-meet", false),
  births("what is made anew on every turn", "made-anew-on-every-turn", false, 2),
  births("whole numbers divided", "whole-numbers-divided", false),
  births("work done ahead of a test that fails", "work-done-ahead-of-a-test-that-fails", false),

  ["aot/backend-packages/more-programs", 0, "./backend-packages/each-program", "testMorePrograms"],
  ["aot/backend-packages/programs", 4, "./backend-packages/each-program", "testPrograms"],
  ["aot/backend-packages/programs-one-file", 0, "./backend-packages/each-program", "testPrograms", [1, 1, "one file"]],
  ["aot/bad-time/bad-time", 8, "./bad-time/run-bad-time", "badTime"],
  ["aot/builtins/differential", 4, "./builtins/differential-cases", "differential"],
  ["aot/builtins/native-contract-in-parts", 4, "./builtins/native-contract/contract", "nativeContractInParts"],
  ["aot/calls-beyond-their-reach", 3, "./joined-programs", "joinedBeyondTheReachOfCalls"],
  ["aot/code-from-disk", 8, "./code-from-disk-cases", "codeFromDisk"],
  ["aot/code-the-compiler-never-saw", 3, "./code-the-compiler-never-saw-cases", "codeTheCompilerNeverSaw"],
  ["aot/collector-stress/full", 30, "./collector-stress/run-collector-stress", "collectorStress", ["full"]],
  ["aot/collector-stress/young", 20, "./collector-stress/run-collector-stress", "collectorStress", ["young"]],
  ["aot/compile-exec-argv-as-without-aot", 3, "./compile-exec-argv-as-without-aot-cases", "execArgvAsWithoutAot"],
  ["aot/each-case-alone", 20, "./each-case-alone-cases", "eachCaseAlone"],
  ["aot/every-program", 64, "./programs-as-entry-points", "programsAsEntryPoints"],
  ["aot/engine-tests-in-parts", 12, "./engine-tests-in-parts", "engineTestsInParts"],
  ["aot/generated-cases-three-ways", 8, "./three-ways/made-cases", "madeCasesOfAllTopics"],
  ["aot/generated-fresh-seeds", 3, "./generated/fresh-seeds", "freshSeeds"],
  ["aot/global-names", 3, "./global-names-cases", "globalNames"],
  ["aot/heat/cold", 8, "./heat/run-heat", "heat", ["cold"]],
  ["aot/heat/hot", 8, "./heat/run-heat", "heat", ["hot"]],
  ["aot/heat/neither", 8, "./heat/run-heat", "heat", ["neither"]],
  ["aot/jit-mode-eager-tier-up", 2, "./jit-mode-eager-tier-up", "eagerTierUpSweep"],
  [
    "aot/joined-programs-predictions-fail",
    12,
    "./joined-programs",
    "joined",
    ["predictions-fail", ["--aot-testing=FailPredictions:2:1"]],
  ],
  ["aot/joined-programs-claims-checked", 3, "./joined-programs", "joined", ["claims-checked", ["--aot-check=ClaimsToBackEnd"]]],
  ["aot/joined-programs-limits-lowered", 9, "./joined-programs", "joinedWithLimitsLowered"],
  ["aot/joined-programs-moved-loads-checked", 3, "./joined-programs", "joined", ["moved-loads-checked", ["--aot-check=MovedLoads"]]],
  // A group of 250 programs costs about one build, so these take fifty times the programs of variant-validate and variant-proofs-checked-at-run-time.
  ["aot/joined-programs-proofs-checked", 3, "./joined-programs", "joined", ["proofs-checked", ["--aot-testing=CheckProofsAtRunTime"]]],
  ["aot/joined-programs-validated", 4, "./joined-programs", "joined", ["validated", ["--aot-validate"]]],
  ["aot/modules-three-ways", 4, "./three-ways/run-three-ways", "threeWays"],
  ["aot/one-line-changes-little", 8, "./one-line-changes-little-cases", "oneLineChangesLittle"],
  ["aot/perf/pinned-applications", 0, "./perf/pinned-applications", "pinnedApplications"],
  ["aot/perf/pinned-everyday-idioms", 4, "./perf/pinned-everyday-idioms", "pinnedEverydayIdioms"],
  ["aot/process-platform-folds", 4, "./process-platform-folds-cases", "processPlatformFolds"],
  ["aot/programs-in-every-run", 32, "./run-programs", "programsInEveryRun"],
  ["aot/programs-marked-as-failing", 0, "./run-programs", "programsMarkedAsFailing"],
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
  ...[
    "bun",
    "thin",
    "hono",
    "elysia",
    "node",
    "koa",
    "express",
    "fastify",
    "fastify-schemas",
    "tanstack",
  ].map((name): Row => [`aot/servers/${name}`, 0, "./servers/one-server", "testServers", ["servers", name]]),
  ...["bun", "elysia", "express", "fastify", "hono", "node"].map(
    (name): Row => [`aot/servers/features-of-${name}`, 0, "./servers/one-server", "testServers", ["features", name]],
  ),
  ...["bun", "elysia", "express", "fastify", "hono", "koa", "node"].map(
    (name): Row => [`aot/servers/budgets-of-${name}`, 0, "./servers/one-server", "testServers", ["budgets", name]],
  ),
  ["aot/servers/api-servers", 0, "./servers/one-server", "testServers", ["api", "api-bun,api-thin,api-hono,api-elysia"]],
  ["aot/servers/api-servers-on-node-http", 0, "./servers/one-server", "testServers", ["api", "api-node,api-express,api-fastify,api-koa"]],
  ["aot/servers/every-pass-changes-one-of-the-servers", 0, "./servers/one-server", "testServers", ["every-pass-changes-a-real-program", "1"]],
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

// What a unit takes of its programs may go by the commit (`inShare` in run-programs.ts). CI runs what is drawn so in a step that holds up nothing, with AOT_TAKES=drawn, and the rest in
// one that does, with AOT_TAKES=fixed. These callees draw and take nothing else:
const onlyDraw = new Set([
  "badTime",
  "collectorStress",
  "eachCaseAlone",
  "eagerTierUpSweep",
  "freshSeeds",
  "heat",
  "joined",
  "joinedWithLimitsLowered",
  "programs",
  "programsAsEntryPoints",
  "programsBuiltWith",
  "programsMarkedAsFailing",
  "testTrimmedMatchesUntrimmed",
  "variantWithTrimmedRuntime",
  "variantsWithoutOneFlowResult",
]);
// And these draw beside what they take in every run.
const alsoDraw = new Set(["birthsAndUses", "madeCasesOfAllTopics", "packages", "programsInEveryRun", "variant"]);
const unitsOfCallees = (callees: Set<string>) => new Set(rows.filter(([, , , callee]) => callees.has(callee)).flatMap(unitsOf).map(name => `${name}.test.ts`));
/** The units that have something for the step that is drawn, and those among them that have nothing for the other. */
export const unitsThatDraw = unitsOfCallees(new Set([...onlyDraw, ...alsoDraw]));
export const unitsThatOnlyDraw = unitsOfCallees(onlyDraw);
