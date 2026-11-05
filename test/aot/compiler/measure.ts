// What the tests of this folder share: the application of bench/compiler is written at a size, built, and the build says what each of its stages has cost.
//
// Three things are read, all of them counts. No clock is read.
//
//   instructions   retired in user mode. Those of the whole command are counted from outside, by ../analysis-scaling/measure-check.ts. Those of a stage are counted by the
//                  build itself, which prints them under BUN_JSC_logAOTPhaseTimes on Linux. Elsewhere a stage has none.
//   touches        the counters of statistics.def, which --explain=statistics prints. They are exact, the same on every machine, and there wherever a build runs.
//   bytes          the most memory that the build had resident while the stage ran. Linux tells it for every stage, macOS for the front end.
//
//   stage      row of the budget                 what else it holds
//   frontEnd   front end                         the sum of load, bind, check, lower and link
//   lowering   lowering's own code               a part of lower. Only a build on one thread prints it
//   read       read, verify
//   scan       Facts: scan to summaries          the keys of texts, the indexes of bodies
//   solve      Facts: Link                       the declared families, the look at bodies, the two readings, the open names of a test run
//   passes     Facts: behind Link                the referrers and the tables of functions, fields, layouts, strings, variables and classes
//   plan       Plan                              the stub catalog, the inputs of Compile, the lists of what Facts found
//   compile                                      the sum of walk and emit
//   walk       walk and sweep
//   emit       emit, allocate, encode
//   image      Image                             the diagnostics, and freeing what the stages left
//
// frontEnd, lower and compile repeat their parts, so nobody adds the stages up: the whole build has a number of its own.
import { existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { generate, write } from "../../../bench/compiler/generate";
import { measureCommandWithMemory } from "../analysis-scaling/measure-check";
import { slot, withoutDebugInformation } from "../harness/commands";
import { buildEnvironment, compileCommand, withThreads } from "../harness/flags";

/** Whether the whole command has `instructions`. A stage may have none all the same. */
export { countsInstructions } from "../analysis-scaling/measure-check";

export const dresses = ["typed", "erased", "mixed", "packages-typed", "packages-untyped"] as const;
export type Dress = (typeof dresses)[number];

export interface Application extends Disposable {
  /** A temporary folder, which goes with the application. What `build` writes lies in it. */
  folder: string;
  entry: string;
  features: number;
  /** Of the files that the compiler is given, as this dress has them. */
  lines: number;
  /** The folder. */
  toString(): string;
}

function countLines(files: Record<string, string>) {
  let lines = 0;
  for (const [path, text] of Object.entries(files))
    if (/(?<!\.d)\.[jt]s$/.test(path)) lines += text.split("\n").length - 1;
  return lines;
}

let linesOfOneFeature: number | undefined;

/**
 * `lines` are those of the typed dress, which is what bench/compiler/run.ts calls a size. Every other dress is the same application with as many features, and has the lines it has.
 * 0 is the application without a feature: what the features share, and a main file that goes over none.
 */
export function application(lines: number, dress: Dress): Application {
  if (!(lines >= 0)) throw new RangeError(`an application of ${lines} lines`);
  linesOfOneFeature ??= countLines(generate(40, "typed")) / 40;
  const features = Math.round(lines / linesOfOneFeature);
  const files = generate(features, dress);
  // The checker takes the type of the elements from the elements, so a list of none has to state it.
  if (features === 0 && "main.ts" in files)
    files["main.ts"] = files["main.ts"]
      .replace("type Command, UsageError", "type Command, type Feature, UsageError")
      .replace("const features = [];", "const features: Feature[] = [];");
  const folder = tempDir(`aot-compiler-${dress}-${features}`, {});
  write(String(folder), files);
  return {
    folder: String(folder),
    entry: "main.ts" in files ? "main.ts" : "main.js",
    features,
    lines: countLines(files),
    toString: () => String(folder),
    [Symbol.dispose]: () => folder[Symbol.dispose](),
  };
}

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const none: string[] = [];

// Every counter of statistics.def stands here once, but for its clocks.
const touchesOf = {
  frontEnd: none,
  load: words(`
    SourceFilesChecked SourceFilesInferred SourceFilesTypesOnly SourceFilesData SourceFilesRuntime SourceFilesDemoted
    SourceBytes SourceLines SourceBytesOfPackages SourceLinesOfPackages SourceBytesOfDeclarations SourceLinesOfDeclarations
    SourceBytesOfBun SourceLinesOfBun`),
  bind: none,
  check: none,
  lower: words(`FunctionsLowered ValuesLowered KnownHelperFunctions KnownHelperCalls`),
  lowering: none,
  link: words(`ProgramBytes ModulesWithNames ModulesWithValue Faces`),
  read: words(`TypesInterned FunctionsRead ValuesRead`),
  scan: words(`ValuesScanned`),
  solve: words(`FactNodes FactEdges FactsCarriedOverEdges FactRounds FactRuleCalls FlowAppendedFields`),
  passes: none,
  plan: words(`ModulesWithoutState RequireSitesBound RequiresRecorded AsyncWorkersMade FieldsOutOfLine`),
  compile: words(`
    UnitsCompiled UnitsWrittenStraight FunctionsWithAllIndirectCallersListed GenericEntriesOpenedByIndirectCalls
    GenericEntriesOpenedBesideCompiledTarget ClosedGenericEntries IndirectCallsThatMayEnterAnyClosure`),
  walk: words(`
    ValuesWalked ValuesWalkedAndKept LoopsWalkedAgain CallsInlined OperationsBuilt OperationsSwept
    DirectCalls IndirectCalls TestsThatRejoin LoopsBuiltTwice TurnsThatBeginAgain
    ProofsCheckedOfEntryParameters ProofsCheckedOfResultsOfCalls ProofsCheckedOfFields ProofsCheckedOfVariables ProofsCheckedOfCaptures ProofsCheckedOfContents
    ProofsCheckedOfCallees ProofsCheckedOfOtherOperations ProofsCheckedOfTests ProofsCheckedOfWhatIsRemembered ProofsThatNoTestTells
    URLsLeftUnbuilt IteratorsSteppedWithoutCall SerializersCreated OwnKeyWalksExpanded AccessesProven AccessesGuarded AccessesUnknown ValuesInDouble
    AssignmentsWrittenOutFieldByField JoinsWalkedOnceForEachWay`),
  emit: words(`
    OperationsEmitted MachineOperationsAppended MachineOperationsScanned MachineOperationsAllocated MachineOperationsEncoded ValuesSpilled
    FormsThatDifferFromSchema FormsPickedByPlaceOtherThanLoop
    OffsetsFoundByComparisons OffsetsFoundInFlatTables OffsetsFoundInHashedTables OffsetsFoundInPagedTables
    BytesOfFlatOffsetTables BytesOfHashedOffsetTables BytesOfPagedOffsetTables
    NativeFunctionsCalledDirectly NativeFunctionTestsEmitted ExactIntegersBehindNumbers StepsThatKnowTheDeletedPrefix LoopsRotated
    InnerPointersAcrossSafepoints NullChecksFoldedIntoAccesses VectorsOfViewsRead AccessesInsideViews`),
  image: words(`
    ThingsMentioned ThingsNumbered IdentifiersNumbered StringConstantsNumbered NamesWithoutColumn MethodTableSelectors MethodTableBytes
    ClassGuardCounts GuardsOfClassGuardCounts
    ImageFunctionsEmitted CodeBytesEmitted StubBytes ConstantBytesEmitted TableBytesEmitted TextBytesEmitted Veneers StubCopiesEmitted
    RegExpsCompiled RegExpsInterpreted
    WasmFunctionsCompiled WasmFunctionsWithTwoCopies WasmCodeBytesEmitted WasmCodeBytesOfSecondCopies
    FunctionBytesEmitted FarInstanceWordBytesEmitted VeneerBytesEmitted SharedCodeBytesEmitted ArgumentThunkBytes FinalJumpBytesRemoved
    FFICodeBytesEmitted FFIDirectoryBytesEmitted RegExpCodeBytesEmitted RegExp16BitCodeBytes RegExpTableBytesEmitted
    ConstantBytesOfSharedConstants ConstantBytesOfShapeSets ConstantBytesOfBitSetsOverKnownShapes ConstantBytesOfOffsetTables
    ConstantBytesOfCellTemplates ConstantBytesOfNumbers UnlabeledConstantBytes ConstantBytesOfJumpTables PaddingBytesBetweenConstants
    ParsersCreated TypedResultsSelected
    InlineFramesEmitted FrameMapBytesEmitted RegExpCandidatesCompiled`),
} satisfies Record<string, string[]>;

// A single step of a page or a code granule is more than the judge's noise of 1000 and hides how these grow, so no growth is asked of them.
const roundingCounters = words(`PaddingBytesBetweenFunctions PaddingBytesBetweenCodeParts`);
// statistics.def: counted by nothing yet.
const countersThatWaitForTheirPort = words(`
    EnvironmentsPromotedToVariables UnreadVariableStoresRemoved LiteralArgumentsTakenApart GetsAnsweredByHas SlotStoreRunGroups KeyPartsLookupGroups
    StoresLeftInLoopsForOthers ElementPresenceTestsPlaced ArrayChainsFused ArrayCapacitiesPlanned AllocationsSunk SwitchesTestedByWindow
    InitializersDeferred ClosuresDeferredInVariables ClassesDeferredInVariables FlowListsNeverToldApart RestartsInGenericVersion TagLookupsWithOtherKeys
    ObjectKeysSearchedInLine BirthsFinished`);

export type StageName = keyof typeof touchesOf;
export const stageNames = Object.keys(touchesOf) as StageName[];

const listedCounters = new Set([...Object.values(touchesOf).flat(), ...roundingCounters, ...countersThatWaitForTheirPort]);

function printedCountsIn(stderr: string) {
  const counts: Record<string, number> = {};
  for (const [, name, value] of stderr.matchAll(/^([A-Z][A-Za-z0-9]*) (\d+)$/gm))
    if (!name.endsWith("Nanoseconds")) counts[name] = Number(value);
  return counts;
}

/** What a build prints and no stage lists. counters-have-stages.test.ts holds it empty, so a counter that the compiler gains turns that test red and no other. */
export function countersWithoutAStage(stderr: string) {
  return Object.keys(printedCountsIn(stderr)).filter(name => !listedCounters.has(name));
}

/** The counters among what a build with --explain=statistics has written to stderr. */
export function countsIn(stderr: string) {
  const counts = printedCountsIn(stderr);
  // A test that asks for one of these would read undefined.
  const notPrinted = [...listedCounters].filter(name => !(name in counts));
  if (notPrinted.length)
    throw new Error(`${import.meta.file} lists touches that --explain=statistics does not print: ${notPrinted.join(", ")}`);
  return counts;
}

export interface Build {
  command: string[];
  executable: string;
  /** Of the whole command, on all its threads. */
  instructions?: number;
  /** The most that the command had resident. */
  peakBytes: number;
  /** Every touch, by its name in statistics.def. */
  counts: Record<string, number>;
  stdout: string;
  stderr: string;
}

const megabyte = 2 ** 20;
const killAfterMilliseconds = 900_000;
// By default the allocator returns freed memory after a delay, by the clock, and two runs of one build differ by up to 40 MB. Without the delay they differ by a few.
const environment = { ...bunEnv, MIMALLOC_PURGE_DELAY: "0", [buildEnvironment.logsPhaseTimes]: "1" };
let carrier: string[] | undefined;
let numberOfBuilds = 0;

/** An application, or any program in a folder. A path alone means the main.ts or main.js in it. */
export type Program = string | { folder: string; entry: string };

function placeOf(program: Program) {
  if (typeof program === "object" && "entry" in program) return program;
  const folder = String(program);
  const entry = ["main.ts", "main.js"].find(name => existsSync(join(folder, name)));
  if (!entry) throw new Error(`${folder} has neither main.ts nor main.js`);
  return { folder, entry };
}

/**
 * Throws unless the build succeeds.
 * On one thread unless the flags say how many: there a build retires the same instructions from run to run, at any load.
 * Each build writes an executable of its own, so several builds of one folder may run at once.
 */
export async function build(program: Program, flags: string[] = []): Promise<Build> {
  const { folder, entry } = placeOf(program);
  const executable = join(folder, `built-${++numberOfBuilds}${isWindows ? ".exe" : ""}`);
  const command = [
    bunExe(),
    ...compileCommand,
    ...(flags.some(flag => flag.startsWith("--aot-threads=")) ? [] : [withThreads(1)]),
    "--explain=statistics",
    ...(carrier ??= withoutDebugInformation()),
    ...flags,
    entry,
    "--outfile",
    executable,
  ];
  const cost = await slot(() => measureCommandWithMemory(folder, command, killAfterMilliseconds, environment));
  // Each line of the log resets the mark that Linux keeps, so what the system says in the end is the most since the last line. The lines say the most so far.
  const peaksInLog = Array.from(cost.stderr.matchAll(/ \| peak (\d+) MB/g), found => Number(found[1]) * megabyte);
  return {
    command,
    executable,
    instructions: cost.instructions,
    peakBytes: Math.max(cost.peakBytes, ...peaksInLog),
    counts: countsIn(cost.stderr),
    stdout: cost.stdout,
    stderr: cost.stderr,
  };
}

export interface Stage {
  /** On all threads. Absent where the build has no counter for the stage. */
  instructions?: number;
  /**
   * The most resident while the stage ran; of a stage of the front end, from the start of the build to the end of the stage. Absent where nothing tells.
   * Walk and emit take turns, unit by unit, on every thread: compile, walk and emit have one number.
   */
  bytes?: number;
  touches: Record<string, number>;
}

const stageOfFrontEnd: Record<string, StageName> = {
  Load: "load",
  BindModules: "bind",
  Check: "check",
  Lower: "lower",
  LinkAndEmit: "link",
};
// Outside the stages: Bun's start and the script that asks for the build, what sets the build up, the engine as a whole, whose own lines count it, and what follows it.
// The number of the whole command holds them all.
const outsideStagesOfFrontEnd = new Set([
  "before the build",
  "in front of Load",
  "the engine",
  "behind the engine",
]);
// Facts prints two kinds of line, both inside the border of Plan. By the whole label.
// These count all threads. They follow one another on the calling thread and overlap nothing, so they are what is counted.
const stageOfFactsStep: Record<string, StageName> = {
  "scan and Link | scan": "scan",
  "scan and Link | families": "solve",
  "scan and Link | Link": "solve",
  "scan and Link | referrers, tables": "passes",
};
// These count one thread, and each is a part or a double of one of the four: it is known and passed by.
const partsOfFactsSteps = new Set([
  "facts | keys of texts",
  "facts | mocks, indexes of bodies",
  "facts | scan, families",
  "facts | look at bodies",
  "facts | the two readings",
  "facts | open names",
  "facts | tables of functions",
  "facts | lay referrers over",
  "facts | rank referrers",
  "facts | facts of the program",
  "facts | tables of fields, layouts, strings, variables, classes",
  "facts | referrers beside tables",
]);
// All that Facts does. The steps in front of the scan, the keys of texts and the indexes of bodies, have no line that counts all threads: they are what this line counts beyond the four.
const allOfFacts = "AnalyzeFlow | compute facts";
// By the first label, up to its colon where it has one: `image: type tables`.
// The instructions that such a line names are counted once more between two borders, so only its memory is read.
const stagesOfEngine: Record<string, StageName[]> = {
  ReadAndVerify: ["read"],
  AnalyzeFlow: ["passes"],
  PlanSlots: ["plan"],
  plan: ["plan"],
  GenerateCode: ["compile", "walk", "emit"],
  BuildImage: ["image"],
  image: ["image"],
};
// These run behind Plan and in front of its border, under the name of another stage.
const stagesOfEngineStep: Record<string, StageName[]> = {
  "GenerateCode | make the inputs of Compile": ["plan"],
  "AnalyzeFlow | write what Facts found": ["plan"],
};
// A checking build verifies behind the border of ReadAndVerify, so the border of Plan counts these two.
const verifierSteps = new Set(["ReadAndVerify | verify records", "ReadAndVerify | verify bodies"]);
const stageOfBorder: Record<string, StageName> = {
  lowering: "lowering",
  ReadAndVerify: "read",
  // What other stages retire inside this border is taken out below.
  "AnalyzeFlow PlanSlots": "plan",
  GenerateCode: "compile",
  "walk and sweep": "walk",
  "emit to encode": "emit",
  BuildImage: "image",
};

function readPhaseLine(line: string) {
  const label = /^AOT phase times: (.+?) \| wall /.exec(line)?.[1];
  if (label === undefined) return undefined;
  const numberIn = (pattern: RegExp) => {
    const found = pattern.exec(line);
    return found ? Number(found[1]) : undefined;
  };
  const millionInstructions = numberIn(/ \| instructions ([\d.]+) M(?: \||$)/);
  return {
    label: label.split(" | "),
    instructions: millionInstructions === undefined ? undefined : Math.round(millionInstructions * 1e6),
    megabytesSoFar: numberIn(/ \| peak (\d+) MB/),
    megabytesSinceLastLine: numberIn(/ \| peak since the last line (\d+) MB/),
  };
}

/** A line of the log that belongs to no stage known here throws: what it counts would be judged by nobody. */
export function stagesOf(build: Build): Record<StageName, Stage> {
  const stages = {} as Record<StageName, Stage>;
  for (const name of stageNames)
    stages[name] = { touches: Object.fromEntries(touchesOf[name].map(touch => [touch, build.counts[touch]])) };

  // A line says 0 where the threads have no counter for what it names.
  const count = (name: StageName, instructions: number | undefined) => {
    if (instructions) stages[name].instructions = (stages[name].instructions ?? 0) + instructions;
  };
  let instructionsInsidePlanBorder = 0;
  let instructionsOfFactsSteps = 0;
  let instructionsOfAllOfFacts: number | undefined;
  const countInsidePlanBorder = (name: StageName, instructions: number | undefined) => {
    count(name, instructions);
    instructionsInsidePlanBorder += instructions ?? 0;
  };
  // A line says 0 where the platform reports no peak.
  const recordPeak = (name: StageName, megabytes: number | undefined) => {
    if (megabytes) stages[name].bytes = Math.max(stages[name].bytes ?? 0, megabytes * megabyte);
  };
  const known = <Found>(found: Found | undefined, line: string) => {
    if (found === undefined) throw new Error(`${import.meta.file} knows no stage for this line of the build: ${line}`);
    return found;
  };

  for (const line of build.stderr.split("\n")) {
    const border = /^AOT instructions: (.+) \| (\d+)$/.exec(line);
    if (border) {
      count(known(stageOfBorder[border[1]], line), Number(border[2]));
      continue;
    }
    const phase = readPhaseLine(line);
    if (!phase) continue;
    const [first, second] = phase.label;
    if (first === "front end") {
      // `LinkAndEmit: emit` is a part of the stage, and the stage's own line counts all its parts. So with `behind the engine: reports`.
      const [stage, part] = second.split(": ");
      if (outsideStagesOfFrontEnd.has(stage)) continue;
      if (part !== undefined) {
        known(stageOfFrontEnd[stage], line);
        continue;
      }
      for (const name of [known(stageOfFrontEnd[second], line), "frontEnd"] as const) {
        count(name, phase.instructions);
        recordPeak(name, phase.megabytesSoFar);
      }
    } else if (first === "scan and Link" || first === "facts") {
      const step = phase.label.join(" | ");
      if (partsOfFactsSteps.has(step)) continue;
      const name = known(stageOfFactsStep[step], line);
      countInsidePlanBorder(name, phase.instructions);
      instructionsOfFactsSteps += phase.instructions ?? 0;
      recordPeak(name, phase.megabytesSinceLastLine);
    } else {
      const step = `${first} | ${second}`;
      if (step === allOfFacts) instructionsOfAllOfFacts = phase.instructions;
      if (verifierSteps.has(step)) countInsidePlanBorder("read", phase.instructions);
      const names = stagesOfEngineStep[step] ?? known(stagesOfEngine[first.split(": ")[0]], line);
      for (const name of names) recordPeak(name, phase.megabytesSinceLastLine);
    }
  }

  if (instructionsOfAllOfFacts && instructionsOfFactsSteps) {
    if (instructionsOfAllOfFacts < instructionsOfFactsSteps)
      throw new Error(
        `${import.meta.file} counts some line of the build twice: the steps of Facts retire ${instructionsOfFactsSteps - instructionsOfAllOfFacts} instructions more than \`${allOfFacts}\``,
      );
    countInsidePlanBorder("scan", instructionsOfAllOfFacts - instructionsOfFactsSteps);
  }

  const { plan } = stages;
  if (plan.instructions !== undefined) {
    plan.instructions -= instructionsInsidePlanBorder;
    if (plan.instructions < 0)
      throw new Error(
        `${import.meta.file} counts some line of the build twice: the steps inside the border of Plan retire ${-plan.instructions} instructions more than the border`,
      );
  }
  return stages;
}
