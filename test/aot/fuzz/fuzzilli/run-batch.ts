// Compiles many programs into one executable, runs each in a Worker of the executable and in a Worker of `bun run`, and compares what they print and how they end.
// README.md beside this file says where the programs come from.
//
//   bun run-batch.ts --bun <the Bun that builds and runs> --programs <folder> --work <folder> --finds <folder> [--count 2000] [--group 500] [--batches 1] [--flags=--aot-threads=1]
//
// It takes `count` files out of `programs` for each batch and waits for more. `--batches 0` never ends. `--seconds 3600` starts no batch behind that time. `--keep` copies the files instead.
// `--count 1,3,12` takes one program for the first batch, three for the second, twelve for the third, one for the fourth. Which code the compiler takes for hot depends on what else the executable holds.
// `--group 1` makes each program an entry point, which the compiler takes for a program of its own: up to 127 of them share an executable and nothing else.
// `--hides-function-text` is for a Bun built with --fuzzilli=on: neither run shows the text of a function, which the two spell differently.
// `--prints-members 60` rewrites 60 programs of 100 so that they print members of their objects in place of the objects (print-members-of-objects.ts).
// `--one-scene 40` leaves 40 programs of 100 one of their scenes.
// `--hooks-fail 30` lets functions that built-ins call end in an error of the engine, in 30 programs of 100.
// `--ordinary-scenes 50` writes scenes of ordinary code into 50 programs of 100, or in their place (write-ordinary-scenes.ts).
// `--scenes-of-every-size 20` writes scenes with a drawn number of cases, elements, fields, operands or levels into 20 programs of 100, or in their place (write-scenes-of-every-size.ts).
// `--hands-over-built-ins 40` puts built-in functions where 40 programs of 100 hand over functions of their own, and `--prints-into-a-text 40` lets 40 of 100 append what they print to a text (hand-over-built-ins.ts).
// `--names-of-globals 20` gives variables of 20 programs of 100 the names of globals.
// `--unwraps-try-blocks 50` takes `try` blocks out of 50 programs of 100.
// `--validates 100` builds each batch a second time with --aot-validate and runs it: a program at which that executable stops is kept.
// `--collects 100` runs each executable a second time in an environment in which it collects at every few allocations and overwrites what it frees: a program that prints something else there, or ends by a signal, is kept.
// `--ends-early 100` runs each executable three times more, and the runner ends the Worker of each program at a moment drawn from a few milliseconds. What is printed doesn't count: a process that ends by a signal is kept.
// `--beside-an-external 50` lets 50 processes of 100 build everything with `--external` for a package that every entry point imports, so the executable also runs code that the compiler hasn't seen.
// `--splits 80` cuts functions and classes of 80 programs of 100 out into other files, with declarations that can be wrong (split-into-files.ts).
// `--draws ts` needs no `--programs`: the driver makes the programs of a batch itself. Each starts empty, and the options above write its scenes.
// `--families 30` draws 30 programs of 100 from the sources of ../sources.ts instead. Those stay as they are drawn.
// `--together 32`, with `--group 1`, first builds a batch with 32 programs to an entry point, which imports them with `import` statements: one program for the compiler, and a Worker runs the 32 one behind the other.
// Only a program that prints something else there than under `bun run` goes on into a batch as above, and so does one that doesn't end by itself and without an error.
// `--throwers 20`, with `--together`, takes 20 of 100 programs that end in an error. Such a program is the last of its entry point, and an entry point costs a build as much as twenty programs.
// `--slow 10`, with `--together`, takes 10 of 100 programs that don't end in time under `bun run`. Each of them needs an entry point to itself.
// `--scene sceneOfASmallPackage`: the ordinary scenes are all of that kind.
// `--only-throwers 12`, with `--together`: one run of this script in eight takes only the programs that end in an error under `bun run`, each as an entry point of its own.
// `--compares-errors`: two runs that end in an error agree only if the last error that each printed has the same class and, but for what it quotes of the source, the same message.
// `--keeps-what-compile-shares`: a program at which the executable differs from `bun run` exactly as one built without --aot does is kept too, as a kind of its own.
// `--options-of-the-project 50`: half of the runs of this script that take TypeScript write one tsconfig.json, drawn for the run, into the folder where Bun is started. `bun run` and the executable follow it alike. `--options-of-the-project '"strict": true'`: every run writes one with these options.
// `--each-a-program 25`: a quarter of the runs of this script leave --together aside: each program is an entry point, which begins a program of its own, at most 120 to a build.
// `--few-to-a-build 50`: half of the runs of this script take one, two, four or eight programs to a build, each an entry point. What a build proves of a small program it does not prove of the same
// program beside a hundred others, and what follows from such a proof shows only there.
// `--launders 50`: in half of the runs of this script every program has values handed through a function that the build knows nothing about (launder-values.ts). Such programs share executables.
// `--checks 50`: half of the other runs, and every run that launders, build with the compiler's checks that move no output: every pass is verified, and references are validated. `--checks never`: no run does.
// `--ignores-type-errors 100` writes `// @ts-ignore` above every line of a TypeScript program. One error of the type checker in one program costs the whole batch a build.
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { withoutInstallingPackages } from "../../harness/without-installing-packages";
import { opensTheWorld } from "../the-world-is-open.ts";
import {
  giveNamesOfGlobals,
  handOverBuiltIns,
  keepWhatIsPrintedInAText,
  unwrapTryBlocks,
} from "./hand-over-built-ins.ts";
import { launderValues } from "./launder-values.ts";
import { endHooksInErrors, keepOneScene, printMembersOfObjects, randomFrom } from "./print-members-of-objects.ts";
import { splitIntoFiles } from "./split-into-files.ts";
import { writeOrdinaryScenes } from "./write-ordinary-scenes.ts";
import { writeScenesOfEverySize } from "./write-scenes-of-every-size.ts";

const { values: options } = parseArgs({
  options: {
    bun: { type: "string", default: process.execPath },
    programs: { type: "string" },
    work: { type: "string" },
    finds: { type: "string" },
    count: { type: "string", default: "2000" },
    group: { type: "string", default: "500" },
    batches: { type: "string", default: "1" },
    seconds: { type: "string", default: "0" },
    flags: { type: "string", default: "" },
    milliseconds: { type: "string", default: "250" },
    keep: { type: "boolean", default: false },
    "prints-members": { type: "string", default: "0" },
    splits: { type: "string", default: "0" },
    "one-scene": { type: "string", default: "0" },
    "hooks-fail": { type: "string", default: "0" },
    "ordinary-scenes": { type: "string", default: "0" },
    "scenes-of-every-size": { type: "string", default: "0" },
    "hands-over-built-ins": { type: "string", default: "0" },
    "prints-into-a-text": { type: "string", default: "0" },
    "names-of-globals": { type: "string", default: "0" },
    "unwraps-try-blocks": { type: "string", default: "0" },
    validates: { type: "string", default: "0" },
    collects: { type: "string", default: "0" },
    "ends-early": { type: "string", default: "0" },
    "beside-an-external": { type: "string", default: "0" },
    draws: { type: "string", default: "" },
    families: { type: "string", default: "0" },
    together: { type: "string", default: "1" },
    throwers: { type: "string", default: "100" },
    slow: { type: "string", default: "100" },
    "ignores-type-errors": { type: "string", default: "0" },
    launders: { type: "string", default: "0" },
    scene: { type: "string", default: "" },
    "each-a-program": { type: "string", default: "0" },
    "few-to-a-build": { type: "string", default: "0" },
    "only-throwers": { type: "string", default: "0" },
    "compares-errors": { type: "boolean", default: false },
    "keeps-what-compile-shares": { type: "boolean", default: false },
    "options-of-the-project": { type: "string", default: "0" },
    checks: { type: "string", default: "0" },
    "hides-function-text": { type: "boolean", default: false },
    // Kinds of outcomes that are only counted otherwise, separated by commas.
    "also-keep": { type: "string", default: "" },
  },
});
const { bun, programs: source, work, finds } = options as Record<string, string>;
if ((!source && !options.draws) || !work || !finds)
  throw new Error("Expected --programs or --draws, --work and --finds");
const [groupSize, batches, milliseconds] = [options.group, options.batches, options.milliseconds].map(Number);
/** Whether every program of this run has values handed through a function that the build knows nothing about. All of them have the world open then, and none waits for others like it. */
const launders = Math.random() * 100 < Number(options.launders);
// The programs that an entry point imports are one program of many modules. What a build proves only of a small program, it never proves there.
const takesOnlyThrowers = !launders && Math.random() * 100 < Number(options["only-throwers"]);
const fewToABuild =
  !launders && !takesOnlyThrowers && Math.random() * 100 < Number(options["few-to-a-build"])
    ? [1, 2, 4, 4, 8][Math.floor(Math.random() * 5)]
    : 0;
if (fewToABuild) console.log(`this run takes ${fewToABuild} programs to a build`);
const isEachAProgram =
  fewToABuild > 0 || (!launders && !takesOnlyThrowers && Math.random() * 100 < Number(options["each-a-program"]));
const together = isEachAProgram ? 1 : Number(options.together);
if (together > 1 && groupSize !== 1) throw new Error("--together goes with --group 1");
/** How many programs a batch takes. The batches go through the list in turn. */
const countsOfPrograms = fewToABuild
  ? [fewToABuild]
  : options.count.split(",").map(each => (isEachAProgram ? Math.min(Number(each), 120) : Number(each)));
let count = countsOfPrograms[0];
const hidesFunctionText = options["hides-function-text"];
const alsoKept = [
  ...options["also-keep"].split(",").filter(Boolean),
  ...(options["keeps-what-compile-shares"] ? ["as an executable without --aot"] : []),
];
const buildFlags = [
  ...options.flags.split(" ").filter(Boolean),
  ...(hidesFunctionText ? ["--no-compile-function-source"] : []),
];
/** A package that stays outside the executable. Beside it the compiler counts on code that it hasn't seen, which can reach every built-in module. */
const packageOutside = Math.random() * 100 < Number(options["beside-an-external"]) ? "a-package-outside" : "";
if (packageOutside) buildFlags.push("--external", packageOutside);
if ((launders && options.checks !== "never") || Math.random() * 100 < Number(options.checks))
  buildFlags.push("--aot-check=verify-each-pass,validate-references");
const importOfThePackageOutside = packageOutside && `import "${packageOutside}";\n`;
const runner = "run-each-program-in-a-worker.ts";
const mark = `=== ${Math.random().toString(36).slice(2)} ended`;
/** What an entry point of several programs prints behind each of them. */
const markBetween = `=== ${Math.random().toString(36).slice(2)} behind`;
/** How many entry points a build takes for programs of their own, less the runner and a few. */
const maxEntryPoints = 120;
const maxFindsIsolated = 8;
/**
 * Beside a program that can evaluate text or load a module under a computed name, all entry points of a build are one program, and the compiler proves less about it.
 * Such programs wait here and share executables with each other. The text only sorts them: the build's report has the say.
 */
const waitingWithTheWorldOpen: string[] = [];
const isWrittenToOpenTheWorld = (text: string) =>
  opensTheWorld(text) || /(?<![.\w$])eval\b|\bgetBuiltinModule\((?!["'`])/.test(text);
// A program that prints without end would fill the disk. How much a run can write to a file, in blocks of 512 bytes.
const maxBlocksWritten = (256 << 20) / 512;

type Spent = { cpuSeconds: number; wallSeconds: number; peakMegabytes: number };
type Ended = { stdout: string; stderr: string; end: string; stoppedBefore?: number[] };

/**
 * How much memory the machine, its memory nodes and the control groups above this process have at this moment, as Linux says it. It is read as soon as a build has ended by SIGSEGV, SIGILL or SIGBUS
 * and kept beside the compiler's last words: whether the machine was short of memory can't be asked later. What can't be read is left out, so elsewhere only the time is kept.
 */
function memoryOfTheMachine() {
  const read = (path: string) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
  };
  const lines = [new Date().toISOString()];
  const take = (path: string, names: RegExp) => {
    for (const line of read(path).split("\n"))
      if (names.test(line)) lines.push(`${path}: ${line.trim().replace(/\s+/g, " ")}`);
  };
  take("/proc/meminfo", /^(?:MemTotal|MemFree|MemAvailable|SwapFree):/);
  for (let node = 0; existsSync(`/sys/devices/system/node/node${node}/meminfo`); node++)
    take(`/sys/devices/system/node/node${node}/meminfo`, /\bMemFree:/);
  take("/proc/vmstat", /^(?:numa_pages_migrated|pgmigrate_fail|pgmajfault|oom_kill) /);
  for (let group = /^0::(\/.*)$/m.exec(read("/proc/self/cgroup"))?.[1] ?? "/"; group !== "/"; group = dirname(group))
    for (const file of ["memory.current", "memory.max", "memory.events"]) {
      const said = read(`/sys/fs/cgroup${group}/${file}`).trim();
      if (said) lines.push(`${group}/${file}: ${said.replace(/\n/g, ", ")}`);
    }
  return lines.join("\n") + "\n";
}
const spent: Record<string, Spent> = {};

async function spawn(stage: string, cmd: string[], cwd: string, env: Record<string, string>, seconds: number) {
  const [stdout, stderr] = [join(cwd, `${stage}.stdout`), join(cwd, `${stage}.stderr`)];
  // A child writes over the start of a file that exists and leaves the rest.
  for (const path of [stdout, stderr]) rmSync(path, { force: true });
  const started = performance.now();
  const child = Bun.spawn({
    cmd,
    cwd,
    // The cache of transpiled files goes by the text of a file alone, and the same text can be a module under one name and a script under another.
    env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", ...env },
    stdin: "ignore",
    stdout: Bun.file(stdout),
    stderr: Bun.file(stderr),
    timeout: Math.ceil(seconds * 1000),
    killSignal: "SIGKILL",
  });
  const exitCode = await child.exited;
  const usage = child.resourceUsage()!;
  const total = (spent[stage] ??= { cpuSeconds: 0, wallSeconds: 0, peakMegabytes: 0 });
  total.cpuSeconds += Number(usage.cpuTime.total) / 1e6;
  total.wallSeconds += (performance.now() - started) / 1000;
  total.peakMegabytes = Math.max(total.peakMegabytes, usage.maxRSS / 2 ** 20);
  return {
    exitCode,
    signal: child.signalCode,
    stdout: readFileSync(stdout, "latin1"),
    stderr: readFileSync(stderr, "latin1"),
  };
}

/**
 * Options of a tsconfig.json that change what a transpiler writes, or what the checker says a value is. One set is drawn for a run of this script: programs wait from batch to batch, and a folder has one tsconfig.json.
 * A program carries the file as its part "./tsconfig.json", so a program that is kept says under which options it was built.
 */
const optionsOfProjects = [
  `"useDefineForClassFields": false`,
  `"useDefineForClassFields": false`,
  `"useDefineForClassFields": false`,
  `"useDefineForClassFields": true`,
  `"target": "ES2020"`,
  `"target": "ES2021", "useDefineForClassFields": true`,
  `"experimentalDecorators": true`,
  `"experimentalDecorators": true, "emitDecoratorMetadata": true`,
  `"experimentalDecorators": true, "useDefineForClassFields": false`,
  `"verbatimModuleSyntax": true`,
  `"strict": true`,
  `"strict": true`,
  `"strict": false`,
  `"strict": true, "strictNullChecks": false`,
  `"strict": true, "exactOptionalPropertyTypes": true`,
  `"strict": true, "noUncheckedIndexedAccess": true`,
  `"strict": true, "useUnknownInCatchVariables": false`,
  `"strict": true, "strictPropertyInitialization": false`,
];
const optionsOfThisProject = options["options-of-the-project"].startsWith('"')
  ? options["options-of-the-project"]
  : // Most programs of a run that splits them lie in a folder with a tsconfig.json of its own (bringsItsOwnTsconfigUnderTheDrawnOne).
    Number(options.splits) < 50 && Math.random() * 100 < Number(options["options-of-the-project"])
    ? optionsOfProjects[Math.floor(Math.random() * optionsOfProjects.length)]
    : "";
if (optionsOfThisProject) console.log(`the tsconfig.json of this run: ${optionsOfThisProject}`);
const partWithTheOptionsOfTheProject = optionsOfThisProject
  ? `// @filename: ./tsconfig.json\n{ "compilerOptions": { "moduleDetection": "force", "module": "preserve", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "noEmit": true, ${optionsOfThisProject} } }\n`
  : "";
/**
 * Under a drawn tsconfig.json a program with one in a folder of its own has no yardstick: in that folder `bun run` follows the drawn one and an executable the folder's, and elsewhere in the program the executable
 * built without --aot can part from both. Such a program is left out of the run.
 */
const bringsItsOwnTsconfigUnderTheDrawnOne = (text: string) =>
  partWithTheOptionsOfTheProject !== "" && hasATsconfigInAFolderOfItsOwn.test(text);
let leftOutUnderTheDrawnTsconfig = 0;
const withTheOptionsOfTheProject = (text: string, extension: string) =>
  partWithTheOptionsOfTheProject && extension.endsWith("ts") && !text.includes("// @filename: ./tsconfig.json\n")
    ? `${text.replace(/\n*$/, "\n")}${partWithTheOptionsOfTheProject}`
    : text;

/**
 * Writes the programs, the groups that import them, and the runner.
 * With `entryPoints`, group n imports the programs that entryPoints[n] lists with `import` statements, and behind each a file that prints `markBetween` and the index.
 */
function layOut(folder: string, texts: string[], extension: string, inGroup: number, entryPoints?: number[][]) {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(join(withoutInstallingPackages(folder), "programs"), { recursive: true });
  texts.forEach((text, index) => {
    // Behind a line "// @filename: ./<name>" stands a file that the program imports by that name. The name is a hash of the file, so programs can share one.
    const [program, ...others] = text.split(/^\/\/ @filename: \.\/(\S+)\n/m);
    // An empty catch block at the top level would hide the message of a documented difference. It goes to stderr, which isn't compared.
    const cast = extension.endsWith("ts") ? " as any" : "";
    writeFileSync(
      join(folder, "programs", index + extension),
      program.replace(
        /\} catch ?\((e\d*)\) \{\n?\}$/gm,
        (_, caught) => `} catch (${caught}) { console.error(String((${caught}${cast})?.message)); }`,
      ),
      "latin1",
    );
    for (let other = 0; other < others.length; other += 2) {
      // The tsconfig.json of the program itself holds for the folder where Bun is started, which is the one above the programs.
      const path =
        others[other] === "tsconfig.json" ? join(folder, others[other]) : join(folder, "programs", others[other]);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, others[other + 1], "latin1");
    }
  });
  entryPoints?.forEach((members, entryPoint) => {
    for (const index of members)
      writeFileSync(
        join(folder, "programs", `behind-${index}${extension}`),
        `console.log("\\n${markBetween} ${index}");\nconsole.error("\\n${markBetween} ${index}");\nexport {};\n`,
      );
    writeFileSync(
      join(folder, `group-${entryPoint}${extension}`),
      importOfThePackageOutside +
        members
          .map(index => `import "./programs/${index}${extension}";\nimport "./programs/behind-${index}${extension}";\n`)
          .join(""),
    );
  });
  for (let first = 0; !entryPoints && first < texts.length; first += inGroup) {
    const rows = texts
      .slice(first, first + inGroup)
      .map((_, offset) => `  () => import("./programs/${first + offset}${extension}"),\n`);
    // A group of one imports its program as an entry point imports a file. What stands behind `import()` is compiled as code that may never run, and no file behind it is left out.
    writeFileSync(
      join(folder, `group-${first / inGroup}${extension}`),
      inGroup === 1
        ? `${importOfThePackageOutside}import "./programs/${first}${extension}";\n`
        : `${importOfThePackageOutside}const programs = [\n${rows.join("")}];\nawait programs[Number(process.env.BATCH_PROGRAM) - ${first}]();\n`,
    );
  }
  copyFileSync(join(import.meta.dir, runner), join(folder, runner));
  if (packageOutside) {
    const root = join(folder, "node_modules", packageOutside);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: packageOutside, version: "1.0.0", type: "module", main: "./index.js" }) + "\n",
    );
    writeFileSync(join(root, "index.js"), "export default 0;\n");
  }
}

/** The largest value of each counter of the compiler in the builds so far. A counter that stays at zero counts something that no program has made the compiler do. */
const largestSeen = new Map<string, number>();

/** The programs in `folder` that import the file or the folder beside them, or a file that imports it. The names of such files and folders are hashes. */
function importersOf(file: string, folder: string) {
  const texts = new Map(
    readdirSync(join(folder, "programs"), { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(({ name }) => [name, readFileSync(join(folder, "programs", name), "latin1")]),
  );
  const isProgram = (name: string) => /^\d+\./.test(name);
  const importers = new Set([file]);
  for (const imported of importers)
    if (!isProgram(imported))
      for (const [name, text] of texts) if (text.includes(imported.replace(/\.[a-z]+$/, ""))) importers.add(name);
  return [...importers].filter(isProgram).map(name => parseInt(name));
}

/** The programs that a path below "programs" belongs to: "programs/3.ts", or a file or a folder that programs import. */
function programsNamedBy(text: string, folder: string) {
  const [, file, index] = /programs[\\/]((?:(\d+)\.)?[^\\/:\s"')]+)/.exec(text) ?? [];
  return file === undefined ? [] : index === undefined ? importersOf(file, folder) : [Number(index)];
}

/** Whether the compiler made one program of the entry points in place of one of each, and the first of our programs that its report names as the reason. */
function programsOf(folder: string, entryPoints: number) {
  type Unseen = { cause: string; builtin: string | null; location: { file: string } | null };
  type Report = { statistics: Record<string, number>; unseenCode: Unseen[] };
  let report: Report;
  try {
    report = JSON.parse(readFileSync(join(folder, "report.json"), "utf8"));
  } catch {
    return {};
  }
  for (const [counter, value] of Object.entries(report.statistics))
    if (value > (largestSeen.get(counter) ?? 0)) largestSeen.set(counter, value);
  const named = report.unseenCode.map(({ location }) => programsNamedBy(location?.file ?? "", folder)[0]);
  const openedBy = named.find(index => index !== undefined);
  return {
    // The compiler runs once for each program. When they turn out to be one, it runs once more.
    areOneProgram: report.statistics.EngineRuns !== entryPoints,
    openedBy,
    openers: [...new Set(named.filter(index => index !== undefined))],
    reasons: report.unseenCode.map(({ cause, builtin }) => cause + (builtin ? ` ${builtin}` : "")).join(", "),
  };
}

type Built = {
  refused: Set<number>;
  /** The first error of each refused program: its code, or its first words. */
  reasonsOfRefusals?: string[];
  /** What the build wrote when it refused programs. */
  errors?: string;
  writesToBuiltins: Set<number>;
  areOneProgram?: boolean;
  openedBy?: number;
  /** All programs that the report names so. */
  openers?: number[];
  reasons?: string;
  stopped?: { reason: string; culprit: number | undefined; stderr: string; machine?: string };
};
/** Builds the executable. Returns the programs that the errors name, or how the compiler stopped. */
async function build(
  folder: string,
  programCount: number,
  extension: string,
  inGroup: number,
  mode = ["--aot", ...buildFlags],
  moreSeconds = 0,
): Promise<Built> {
  const groups = Array.from(
    { length: Math.ceil(programCount / inGroup) },
    (_, group) => `./group-${group}${extension}`,
  );
  // A build with --aot-validate takes three times as long, and a build that ends in errors is paid on top of the one that follows it.
  const stage = mode.includes("--aot-validate") ? "validating-build" : "build";
  const before = { ...spent[stage] };
  const ran = await spawn(
    stage,
    [
      bun,
      "build",
      "--compile",
      ...mode,
      ...(mode.includes("--aot") ? ["--aot-report", join(folder, "report.json")] : []),
      "./" + runner,
      ...groups,
      "--outfile",
      join(folder, "batch"),
    ],
    folder,
    {},
    // Each entry point is a program, which holds the part of the library that it uses.
    60 + programCount + 3 * groups.length + moreSeconds,
  );
  // "error: .." or "warn: ..", and below it "at <file>:<line>:<column>".
  const [refused, writesToBuiltins] = [new Set<number>(), new Set<number>()];
  const reasonsOfRefusals: string[] = [];
  let header = "";
  for (const line of ran.stderr.split("\n")) {
    if (/^(error|warn|note)\b/.test(line)) header = line;
    if (!/^\s+at .*programs[\\/][^:]+:\d+/.test(line)) continue;
    for (const program of programsNamedBy(line, folder)) {
      if (header.startsWith("error") && !refused.has(program))
        reasonsOfRefusals.push(/\bTS\d+\b/.exec(header)?.[0] ?? header.slice(7, 47));
      if (header.startsWith("error")) refused.add(program);
      if (header.includes("read-only in a compiled executable")) writesToBuiltins.add(program);
    }
  }
  if (ran.exitCode === 0 && existsSync(join(folder, "batch")))
    return { refused: new Set<number>(), writesToBuiltins, ...programsOf(folder, groups.length + 1) };
  const failed = (spent["failed-build"] ??= { cpuSeconds: 0, wallSeconds: 0, peakMegabytes: 0 });
  failed.cpuSeconds += spent[stage].cpuSeconds - (before.cpuSeconds ?? 0);
  failed.wallSeconds += spent[stage].wallSeconds - (before.wallSeconds ?? 0);
  failed.peakMegabytes = Math.max(failed.peakMegabytes, spent[stage].peakMegabytes);
  if (before.cpuSeconds === undefined) delete spent[stage];
  else spent[stage] = before as Spent;
  // Of several such lines, the first that names a program.
  const stops = [...ran.stderr.matchAll(/internal compiler error.*$|Stopped while compiling.*$/gm)].map(
    ([stop]) => stop,
  );
  const reason = stops.find(stop => programsNamedBy(stop, folder).length) ?? stops[0];
  if (!ran.signal && reason === undefined && refused.size)
    return { refused, reasonsOfRefusals, errors: ran.stderr.slice(0, 32 << 10), writesToBuiltins };
  const culprit = programsNamedBy(reason ?? "", folder)[0];
  // A compiler that ends by a signal says why in a line of its own, and two such ends in one pass are two finds.
  const panic = /^panic(?:\([^)\n]*\))?: .*$/m.exec(ran.stderr)?.[0];
  const said = [panic, reason].filter(line => line !== undefined).join(" | ");
  return {
    refused,
    writesToBuiltins,
    stopped: {
      reason: `${ran.signal ?? `exit code ${ran.exitCode}`}: ${said || "the errors name no program"}`,
      culprit,
      stderr: ran.stderr.slice(-8000),
      machine: /^SIG(?:SEGV|ILL|BUS)$/.test(ran.signal ?? "") ? memoryOfTheMachine() : undefined,
    },
  };
}

/**
 * Runs the programs one after the other in one process. When the process ends early, the program it was in gets the blame and the rest run in a new process.
 * The thread of a program that the runner stopped can outlive its mark, so the blamed program also lists those.
 */
async function run(
  stage: string,
  command: string[],
  folder: string,
  extension: string,
  inGroup: number,
  indexes: number[],
  limit: number,
  env: Record<string, string> = {},
) {
  const results = new Map<number, Ended>();
  let left = indexes;
  while (left.length) {
    const ran = await spawn(
      stage,
      [
        "sh",
        "-c",
        `ulimit -f ${maxBlocksWritten}; exec "$0" "$@"`,
        ...command,
        String(inGroup),
        extension.slice(1),
        ...left.map(String),
      ],
      folder,
      { ...env, BATCH_MARK: mark, BATCH_MILLISECONDS: String(limit) },
      30 + (left.length * limit) / 100,
    );
    const split = (text: string) => text.split(new RegExp(`\\n${mark} (\\d+) (\\S+)\\n`));
    const [stdout, stderr] = [split(ran.stdout), split(ran.stderr)];
    const marks = (Math.min(stdout.length, stderr.length) / 3) | 0;
    // The thread of a program that the runner stopped can write into a mark. The programs from there on run again.
    let ended = 0;
    while (
      ended < marks &&
      Number(stdout[3 * ended + 1]) === left[ended] &&
      Number(stderr[3 * ended + 1]) === left[ended]
    )
      ended++;
    for (let position = 0; position < ended; position++) {
      results.set(left[position], {
        stdout: stdout[3 * position],
        stderr: stderr[3 * position],
        end: stdout[3 * position + 2],
      });
    }
    if (ended < left.length)
      results.set(left[ended], {
        stdout: stdout[3 * ended],
        stderr: stderr[3 * ended].slice(-4000),
        // Behind the bound nothing is written any more, so the marks of the programs that follow are missing too.
        end:
          ended < marks || Math.max(ran.stdout.length, ran.stderr.length) >= maxBlocksWritten * 512
            ? "output"
            : `the process ended: ${ran.signal ?? `exit code ${ran.exitCode}`}`,
        stoppedBefore: left.slice(0, ended).filter(index => isLimit(results.get(index)!)),
      });
    left = left.slice(ended + 1);
  }
  return results;
}

// What a compiled program says when it does something that docs/compiler/compatibility.mdx lists, and what a program names when its output depends on such a thing or on the collector.
// The same lists as in src/runtime/cli/fuzzilli_run_comparison.rs, which has `namesOfDetails` among the names.
const documentedMessages = [
  "read-only in a compiled executable",
  "Attempted to assign to readonly property",
  "this executable was compiled assuming",
  "Maximum call stack size exceeded",
];
const documentedNames = [
  "eval(",
  "Function(",
  ".caller",
  "WeakRef",
  "FinalizationRegistry",
  "import.meta",
  "__filename",
  "__dirname",
  ".argv",
];
/** A stored program that is held to an output of its own says so in its head. The families that draw stored programs as they are bring it here. */
const saysThatPlainBunDiffers = "Plain Bun prints another output.";
/** A stored program of ../../parallel ends in a comment with what it prints, and the tests hold the executable to that, whatever `bun run` prints. */
const printsItsStoredOutput = (text: string, ours: Ended) => {
  const stored = /^\/\* Output:\n([^]*?)\*\/$/m.exec(text)?.[1];
  return stored !== undefined && ours.stdout.trimEnd() === stored.trimEnd();
};
/** What these hold differs between the two runs, and so does what a program prints from them. What else it prints doesn't. */
const namesOfDetails = [".stack", ".message", ".raw"];

/** What a program printed, cut in front of each line that starts with a word. A generated program prints a label first, and the lines of an object are indented. */
function recordsOf(output: string) {
  const records: { label: string; printed: string }[] = [];
  for (const line of removeDetailsOfErrors(output).split("\n")) {
    const label = /^[A-Za-z_$][\w$]*/.exec(line)?.[0];
    if (label === undefined && records.length) records.at(-1)!.printed += "\n" + line;
    else records.push({ label: label ?? "", printed: line });
  }
  return records;
}

/**
 * The lines of `text` that name one of `namesOfDetails`, or a variable that such a line names, and so on.
 * A variable of a generated program ends in a number. A line inside a function or a class counts for the lines that open those too.
 */
function linesDerivedFromDetails(text: string) {
  const lines = text.split("\n");
  const variablesOf = lines.map(line => line.match(/(?<![.\w$"])[A-Za-z_$]+\d+\b/g) ?? []);
  const derived = new Set<string>();
  const isDerived = lines.map(line => namesOfDetails.some(name => line.includes(name)));
  for (let grew = true; grew; ) {
    grew = false;
    lines.forEach((line, index) => {
      if (!isDerived[index] && !variablesOf[index].some(variable => derived.has(variable))) return;
      const around = [index];
      for (let above = index - 1, indent = line.search(/\S/); above >= 0 && indent > 0; above--) {
        const indentAbove = lines[above].search(/\S/);
        if (indentAbove < 0 || indentAbove >= indent) continue;
        indent = indentAbove;
        if (opensAFunctionOrAClass.test(lines[above])) around.push(above);
      }
      for (const one of around) {
        grew ||= !isDerived[one];
        isDerived[one] = true;
        for (const variable of variablesOf[one]) derived.add(variable);
      }
    });
  }
  return lines.filter((_, index) => isDerived[index]);
}

/**
 * Whether the two runs end alike and print the same under every label that a statement outside `linesDerivedFromDetails` prints: as many such records, in the same order, with the same words.
 * What comes from the details can be longer in one run than in the other, so the records aren't held against each other by their place.
 */
function differOnlyInDetails(text: string, a: Ended, b: Ended) {
  if (a.end !== b.end || !namesOfDetails.some(name => text.includes(name))) return false;
  const lines = text.split("\n");
  const derived = linesDerivedFromDetails(text);
  const compared = new Map<string, boolean>();
  const isCompared = (label: string) => {
    if (!compared.has(label)) {
      const prints = (line: string) => (label === "noted" ? line.includes("note(") : line.includes(`"${label}`));
      compared.set(label, lines.some(prints) && !derived.some(prints));
    }
    return compared.get(label)!;
  };
  const [left, right] = [a, b].map(({ stdout }) =>
    recordsOf(stdout)
      .filter(({ label }) => isCompared(label))
      .map(({ printed }) => printed)
      .join("\n"),
  );
  return left === right;
}

/** `Reflect.setPrototypeOf()` of a built-in object returns false in an executable, and `Object.setPrototypeOf()` throws. */
// `bun run` replaces the length and the characters of a string that it knows by their values, also below `delete`.
const deletesTheLengthOfAString = /\bdelete \(?(?:"[^"\n]*"|t\d+)(?: as any)?\)?\.length\b/;
const deletesACharacterOfAString =
  /\bdelete \(?"[^"\n]*"(?: as any)?\)?\[\d+\]|\bconst (t\d+) = "[^"\n]*";\n.*\bdelete \(?\1(?: as any)?\)?\[\d+\]/;
const setsThePrototypeOfABuiltIn = /\bsetPrototypeOf\([A-Z]/;
/**
 * A folder of the program has a tsconfig.json of its own. With `bun run` every file follows the tsconfig.json where Bun is started. In an executable, with --aot or without, each file follows the one nearest
 * to it (docs/compiler/compatibility.mdx, "What differs on purpose"). The two part where either names an option that changes what is written, such as whether fields are assigned or defined, and the one
 * where Bun is started can be drawn (--options-of-the-project). Such a program is held against the executable built without --aot as well.
 */
const hasATsconfigInAFolderOfItsOwn = /^\/\/ @filename: \.\/[^\n]+\/tsconfig\.json$/m;
/**
 * What a part under a tsconfig.json of its own prints is judged by the executable built without --aot, which follows that file as ours does and as `bun run` does not. Where that executable
 * doesn't start, because a name that the bundler made for the exports of a file is not defined, nothing is left to judge those lines by. The scene prints them under the label "options <n>".
 */
const lacksTheYardstickOfItsOwnOptions = (ours: Ended, underBunRun: Ended, withoutAot: Ended) => {
  const [left, right] = [ours.stdout.split("\n"), underBunRun.stdout.split("\n")];
  return (
    /\bexports_\w+ is not defined/.test(withoutAot.stderr) &&
    ours.end === underBunRun.end &&
    left.length === right.length &&
    left.every((line, at) => line === right[at] || (/^options \d+ /.test(line) && /^options \d+ /.test(right[at])))
  );
};
/**
 * Such a program can hold more than the file in that folder, and in the rest the executable built without --aot can be the one that parts from `bun run`, also by a line more or less. So the program is held against
 * both: it ends as both do, prints as many lines as `bun run`, and each of its lines is the line of `bun run` at that place or one of the lines of the other executable.
 */
const printsOnlyLinesOfEither = (ours: Ended, plain: Ended, other: Ended) => {
  const [lines, ofPlain, ofOther] = [ours, plain, other].map(({ stdout }) => removeDetailsOfErrors(stdout).split("\n"));
  const amongOther = new Set(ofOther);
  return (
    ours.end === plain.end &&
    ours.end === other.end &&
    lines.length === ofPlain.length &&
    lines.every((line, at) => line === ofPlain[at] || amongOther.has(line))
  );
};

// What `bun run` says when it refuses a file that the compiler builds.
const refusalsOfBunRun = [
  "is a constant",
  // A variable at the top of a file that `bun run` takes for CommonJS, named like a parameter of the function around such a file.
  "Cannot declare a let variable twice",
  "Left side of assignment is not a reference",
  "Unexpected token '...'",
  "Cannot call constructor in an optional chain",
  "Unexpected private name",
  "Ambiguous unary expression",
  "cannot cross static block boundary",
];
/** Under "experimentalDecorators" `bun run` and `bun build` without --aot read `accessor` as the name of a field, so they stop at the name behind it: `accessor seen = 0`. */
const hasAnAccessorFieldUnderExperimentalDecorators = (text: string) =>
  /"experimentalDecorators": true/.test(text) && /^\s*(?:static\s+)?accessor\s+[\w#[]/m.test(text);
const isRefusedByBunRun = (text: string, stderr: string) =>
  refusalsOfBunRun.some(message => stderr.includes(message)) ||
  (hasAnAccessorFieldUnderExperimentalDecorators(text) && stderr.includes('Expected ";" but found'));

/** `console.log(error)` prints lines of the source, which an executable doesn't have, a message, whose words can differ, and a stack. A time is that of the run. */
const removeDetailsOfErrors = (output: string) =>
  output
    .replace(/[ \t]*\d+ \| .*\n(?:\s*\d+ \| .*\n|[\^~ ]+\n)*/g, " ")
    .split("\n")
    .filter(line => !/^\s*(\d+ \| |[\^~ ]+$|at )/.test(line))
    // Members of an error, printed as those of an object: where the file is, and the place in the text that `bun run` makes of the file.
    .filter(line => !/^\s*(originalLine|originalColumn|sourceURL|stack): /.test(line))
    .map(line =>
      line
        .replace(/^\s+(?=\w*Error\b)/, "")
        .replace(/Error: .*/, "Error")
        // A message that the program prints by itself: an executable quotes less of the source in it ("Error messages" in docs/compiler/compatibility.mdx). The words in front are compared.
        .replace(/ \(evaluating '.*'\)/, "")
        // The message of `in` begins with the source of its right side, for which an executable names the value.
        .replace(/^.* is not an Object\./, "<something> is not an Object.")
        .replace(/\[(\w*Function): [^\]]*\]/g, "[$1]")
        .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "<a time>")
        .replace(/\b\d{1,2} [A-Z][a-z]{2} \d\d:\d\d:\d\d\b/g, "<a time>")
        .replace(
          /\b[A-Z][a-z]{2},? (?:[A-Z][a-z]{2} \d\d|\d\d [A-Z][a-z]{2}) \d{4} \d\d:\d\d:\d\d GMT\S*(?: \([^)]*\))?/g,
          "<a time>",
        ),
    )
    .join("\n");
/**
 * The class and the message of the last error in what a run wrote to stderr, which is the one that ended it. An executable quotes less of the source in a message than `bun run` does
 * (docs/compiler/compatibility.mdx, "Error messages"), so what is quoted is left out, and so is what stands in front of "is not a function" and the like.
 */
function lastError({ stderr }: Ended) {
  const [, name = "", message = ""] = [...stderr.matchAll(/^[ \t]*(\w*[Ee]rror): ?(.*)$/gm)].at(-1) ?? [];
  return {
    name,
    message: message
      .replace(/ ?\((?:evaluating|In|near) '.*\)\.?$/, "")
      .replace(
        /^.* is not (a function|a constructor|an object|an Object|iterable|callable)\b.*$/,
        "something is not $1",
      )
      .replace(/'[^']*'|"[^"]*"/g, "''"),
  };
}
const endInTheSameError = (a: Ended, b: Ended) =>
  !options["compares-errors"] ||
  a.end !== "error" ||
  (lastError(a).name === lastError(b).name && lastError(a).message === lastError(b).message);
const agree = (a: Ended, b: Ended) =>
  a.end === b.end && removeDetailsOfErrors(a.stdout) === removeDetailsOfErrors(b.stdout) && endInTheSameError(a, b);
/** The text of a function is a key or a part of a string, and the two runs differ in where its lines break and in parentheses that change nothing. */
const withoutLayout = (output: string) => removeDetailsOfErrors(output).replace(/\\n|[\s()]/g, "");
const agreeButForLayout = (a: Ended, b: Ended) =>
  a.end === b.end && withoutLayout(a.stdout) === withoutLayout(b.stdout);
/**
 * Whether an object literal or a class in `text` has two getters, or two setters, of one name. Where that key stands among the others differs then.
 * A generated program has one member a line, indented by its depth.
 */
function definesAnAccessorTwice(text: string) {
  const bodies: { indent: number; accessors: Set<string> }[] = [];
  for (const line of text.split("\n")) {
    const indent = line.search(/\S/);
    if (indent < 0) continue;
    while (bodies.length && bodies.at(-1)!.indent > indent) bodies.pop();
    const accessor = /^\s*((?:static )?[gs]et (?:[\w$#]+|"[^"]*"))\(/.exec(line)?.[1];
    if (!accessor) continue;
    if (bodies.at(-1)?.indent !== indent) bodies.push({ indent, accessors: new Set() });
    if (bodies.at(-1)!.accessors.has(accessor)) return true;
    bodies.at(-1)!.accessors.add(accessor);
  }
  return false;
}
/** A function under a computed key that is a literal shows that key as its name in an executable: `[Function: 1.5]` for `[Function]`. */
const hasALiteralAsComputedKey = /^\s*(?:(?:static|async|get|set)\s+)*\*?\s*\[\(?-?(?:\d|NaN\b|Infinity\b|")/m;
const withoutNamesOfFunctions = (output: string) =>
  removeDetailsOfErrors(output).replace(/\[(\w*Function|class)\b[^\]]*\]/g, "[$1]");
const opensAFunctionOrAClass =
  /\bfunction\b|\bclass\b|^\s*static \{$|^\s*(?!(?:if|for|while|switch|catch|with)\b)(?:(?:static|async|get|set)\s+)*\*?\s*(?:[\w$#]+|"[^"]*"|\[.*\])\s*\(.*\{$/;
/** `text` with `undefined` for `this` outside every function and class. In a module that is `undefined` in an executable and `null` under `bun run`. */
function withUndefinedAsThisOfTheModule(text: string) {
  const blocks: { indent: number; hasItsOwnThis: boolean }[] = [];
  return text
    .split("\n")
    .map(line => {
      const indent = line.search(/\S/);
      if (indent < 0) return line;
      while (blocks.length && blocks.at(-1)!.indent >= indent) blocks.pop();
      const isOfTheModule = !blocks.some(block => block.hasItsOwnThis);
      const opens = opensAFunctionOrAClass.test(line);
      if (line.endsWith("{")) blocks.push({ indent, hasItsOwnThis: opens });
      if (!isOfTheModule) return line;
      if (!opens) return line.replace(/\bthis\b/g, "undefined");
      // The computed key of a method belongs to the code around the method.
      return line.replace(
        /^(\s*(?:(?:async|get|set)\s+)*\*?\s*\[)(.*)(\]\s*\()/,
        (_, before, key, after) => before + key.replace(/\bthis\b/g, "undefined") + after,
      );
    })
    .join("\n");
}
const readsThisOfTheModule = (text: string) => withUndefinedAsThisOfTheModule(text) !== text;
const withNullAsUndefined = (output: string) =>
  removeDetailsOfErrors(output)
    .replace(/\[Object: null prototype\] /g, "")
    .replace(/\bnull\b/g, "undefined");
const isLimit = ({ end }: Ended) => end === "time" || end === "memory" || end === "output";
/** Thousands of buffers that can grow take more addresses than a process can reserve. */
const reservedTooManyAddresses = ({ stderr }: Ended) => stderr.includes("mprotect failed: Cannot allocate memory");
const classOfError = ({ stderr }: Ended) => /\b\w*Error\b/.exec(stderr)?.[0];

function keepFind(kind: string, summary: string, files: Record<string, string>) {
  // The kernel, the bound of `spawn`, or whoever stops the lane ended that build.
  if (/^SIG(?:KILL|TERM): the errors name no program$/.test(summary)) return;
  // What a compiler says when it stops names a function, a value and a place, which differ from program to program.
  const words = kind.endsWith("build-stopped") ? summary.replace(/'[^'\n]*'|\bat \S+|\bfunction \S+/g, "") : summary;
  const group = `${kind.replaceAll(" ", "-")}-${Bun.hash
    .crc32(words.replace(/[0-9a-f]/gi, ""))
    .toString(16)
    .padStart(8, "0")}`;
  const name = `${group}/${Math.floor(Math.log2(Math.max(1, Object.values(files)[0].length)))}`;
  if (existsSync(join(finds, name))) return;
  mkdirSync(join(finds, name), { recursive: true });
  for (const [file, text] of Object.entries(files))
    writeFileSync(
      join(finds, name, file),
      /^(program|neighbors)/.test(file) ? text : text.slice(0, 64 << 10),
      "latin1",
    );
  appendFileSync(join(finds, "index.txt"), name + "\n");
}

const firstDifference = (a: string, b: string) => {
  const [left, right] = [removeDetailsOfErrors(a).split("\n"), removeDetailsOfErrors(b).split("\n")];
  const line = left.findIndex((text, index) => text !== right[index]);
  return `compiled: ${(left[line] ?? "").slice(0, 400)}\nbun run:  ${(right[line] ?? "").slice(0, 400)}\n`;
};

/** Both ways over `texts`, in a folder of their own. Returns whether program `index` still differs. */
async function differsAmong(
  folder: string,
  texts: string[],
  extension: string,
  index: number,
): Promise<boolean | undefined> {
  const inGroup = Math.min(groupSize, texts.length);
  layOut(folder, texts, extension, inGroup);
  await build(folder, texts.length, extension, inGroup);
  if (!existsSync(join(folder, "batch"))) return undefined;
  const compiled = (
    await run("compiled", [join(folder, "batch")], folder, extension, inGroup, [index], milliseconds * 20)
  ).get(index)!;
  const plain = (
    await run("plain", [bun, "run", "./" + runner], folder, extension, inGroup, [index], milliseconds * 20, plainEnv)
  ).get(index)!;
  return !agree(compiled, plain);
}
/** The kernel does that to a process whose group is out of memory, and `spawn` at its bound. */
const wasKilled = ({ end }: Ended) => end === "the process ended: SIGKILL";
const plainEnv: Record<string, string> = hidesFunctionText ? { BUN_FUZZILLI_HIDES_FUNCTION_TEXT: "1" } : {};

/**
 * The programs in an executable that is built without --aot. What differs from `bun run` there in the same way belongs to executables as such.
 * Each program is a group of its own: that build makes one module of a group, and a program that cannot be part of a module would fail its neighbors.
 * Leaves out the programs that the build refuses.
 */
async function runInOrdinaryExecutable(indexes: number[], texts: string[], extension: string) {
  const folder = join(work, `ordinary-${process.pid}`);
  const results = new Map<number, Ended>();
  let left = indexes;
  while (left.length) {
    layOut(
      folder,
      left.map(index => texts[index]),
      extension,
      1,
    );
    const { refused } = await build(folder, left.length, extension, 1, []);
    if (existsSync(join(folder, "batch"))) {
      const positions = left.map((_, position) => position);
      const ran = await run("ordinary", [join(folder, "batch")], folder, extension, 1, positions, milliseconds * 20);
      left.forEach((index, position) => results.set(index, ran.get(position)!));
      break;
    }
    if (refused.size === 0) break;
    left = left.filter((_, position) => !refused.has(position));
  }
  rmSync(folder, { recursive: true, force: true });
  return results;
}

/** Whether what `bun run` prints for the one program in `folder` changes with the size of the stack. An executable's frames have other sizes. */
async function printsTheDepthOfTheStack(folder: string, extension: string) {
  const outputs: string[] = [];
  for (const kilobytes of [8192, 2048]) {
    const command = ["sh", "-c", `ulimit -s ${kilobytes}; exec "$0" run "$1"`, bun, `./programs/0${extension}`];
    outputs.push(removeDetailsOfErrors((await spawn("stack", command, folder, plainEnv, 30)).stdout));
  }
  return outputs[0] !== outputs[1];
}

/** Whether what the executable of the one program in `folder` prints changes when it is built without the text of its functions. */
async function printsFromTheTextOfFunctions(folder: string, extension: string) {
  const outputs: string[] = [];
  for (const more of [[], ["--no-compile-function-source"]]) {
    await build(folder, 1, extension, 1, ["--aot", ...buildFlags, ...more]);
    const ran = await run("text", [join(folder, "batch")], folder, extension, 1, [0], milliseconds * 20);
    outputs.push(removeDetailsOfErrors(ran.get(0)!.stdout));
  }
  return outputs[0] !== outputs[1];
}

/** Whether `bun run` prints what the executable printed once `this` of the module is `undefined` there too. Lays the changed program out in `folder`. */
async function agreesWithUndefinedAsThisOfTheModule(
  folder: string,
  extension: string,
  text: string,
  { stdout }: Ended,
) {
  layOut(folder, [withUndefinedAsThisOfTheModule(text)], extension, 1);
  const ran = await spawn("this", [bun, "run", `./programs/0${extension}`], folder, plainEnv, 30);
  return removeDetailsOfErrors(ran.stdout) === removeDetailsOfErrors(stdout);
}

/** `ended` with what the one program in `folder` writes to stderr as an executable of its own. A Worker reports the first of several errors. */
async function withErrorsOfItsOwnExecutable(folder: string, extension: string, ended: Ended): Promise<Ended> {
  const own = join(folder, "own");
  await spawn(
    "own-build",
    [bun, "build", "--compile", "--aot", ...buildFlags, `./programs/0${extension}`, "--outfile", own],
    folder,
    {},
    120,
  );
  if (!existsSync(own)) return ended;
  const ran = await spawn("own", ["sh", "-c", `ulimit -f ${maxBlocksWritten}; exec "$0"`, own], folder, {}, 30);
  rmSync(own, { force: true });
  return { ...ended, stderr: ended.stderr + ran.stderr.slice(0, 64 << 10) };
}

/** Whether the executable stopped at a name that `bun run` doesn't know either. `bun run` removes an unused read of some names. */
async function stoppedAtANameThatDoesNotExist(folder: string, { stderr }: Ended) {
  const name = /ReferenceError: ([\w$]+) is not defined/.exec(stderr)?.[1];
  if (!name) return false;
  writeFileSync(join(folder, "name.js"), `console.log(typeof ${name});`);
  return (await spawn("name", [bun, "run", "./name.js"], folder, plainEnv, 30)).stdout === "undefined\n";
}

/**
 * Whether the executable read a variable before its declaration ran, in an expression that nothing uses. `bun run` removes such an expression.
 * Builds the one program in `folder` again from the text that `bun run` makes of it, and compares that executable with `bun run`.
 */
async function stoppedAtAnUnusedReadBeforeTheDeclaration(
  folder: string,
  extension: string,
  text: string,
  compiled: Ended,
  reference: Ended,
) {
  const mentions = ({ stdout, stderr }: Ended) =>
    (stdout + stderr).split(/ReferenceError|before initialization/).length;
  if (mentions(compiled) <= mentions(reference)) return false;
  layOut(folder, [text], extension, 1);
  const rewritten = await spawn("rewrite", [bun, "build", "--no-bundle", `./programs/0${extension}`], folder, {}, 30);
  if (rewritten.exitCode !== 0) return false;
  const otherFiles = /^\/\/ @filename: [^]*/m.exec(text)?.[0] ?? "";
  const asJavaScript = extension.replace("t", "j");
  // That text still has the test of a variable in front of an empty block, which reads nothing under `bun run`.
  const withoutTestsOfNothing = rewritten.stdout.replace(/^\s*if \(!*[\w$]+\) \{\}\n/gm, "");
  layOut(folder, [withoutTestsOfNothing + otherFiles], asJavaScript, 1);
  await build(folder, 1, asJavaScript, 1);
  if (!existsSync(join(folder, "batch"))) return false;
  const ran = await run("rewritten", [join(folder, "batch")], folder, asJavaScript, 1, [0], milliseconds * 20);
  return agree(ran.get(0)!, reference);
}

/**
 * Whether the two runs print the same but for the names of functions that the program declares in blocks, and of classes and functions in constants that are used once.
 * `bun run` makes a variable with a function expression of such a declaration, and puts such a constant in place of its use. Neither has a name of its own then.
 */
async function agreesButForFunctionsDeclaredInBlocks(
  folder: string,
  extension: string,
  text: string,
  compiled: Ended,
  reference: Ended,
) {
  layOut(folder, [text], extension, 1);
  const rewritten = await spawn("rewrite", [bun, "build", "--no-bundle", `./programs/0${extension}`], folder, {}, 30);
  const names = [...rewritten.stdout.matchAll(/\blet ([\w$]+) = (?:async )?function\b/g)]
    .map(([, name]) => name.replaceAll("$", "\\$"))
    .filter(name => new RegExp(`\\bfunction\\*? ?${name}\\b`).test(text));
  for (const [, name] of text.matchAll(/\bconst ([\w$]+) = (?:class|(?:async )?function)\b/g))
    if (text.split(new RegExp(`\\b${name.replaceAll("$", "\\$")}\\b`)).length === 3)
      names.push(name.replaceAll("$", "\\$"));
  if (names.length === 0 || compiled.end !== reference.end) return false;
  const withoutThem = (output: string) =>
    removeDetailsOfErrors(output).replace(new RegExp(`\\b(?:${names.join("|")})\\b ?`, "g"), "");
  return withoutThem(compiled.stdout) === withoutThem(reference.stdout);
}

/** `[key]: value` in an object literal. Not `[key: string]: value` in a type. */
const computedKeyOfAValue = /(?<=[{,]\s*|^\s*)\[(?![\w$]+\??: )((?:[^\[\]\n]|\[[^\[\]\n]*\])+)\](?=: )/gm;
const withKeysConvertedBeforeValues = (text: string) =>
  text.replace(computedKeyOfAValue, "[Reflect.ownKeys({ [$1]: 0 })[0]]");
/** Whether `bun run` prints what the executable printed once it converts each computed key to a property key before it evaluates the value beside it. Lays the changed program out in `folder`. */
async function agreesWithKeysConvertedBeforeValues(folder: string, extension: string, text: string, { stdout }: Ended) {
  layOut(folder, [withKeysConvertedBeforeValues(text)], extension, 1);
  const ran = await spawn("keys", [bun, "run", `./programs/0${extension}`], folder, plainEnv, 30);
  return removeDetailsOfErrors(ran.stdout) === removeDetailsOfErrors(stdout);
}

/** Whether `bun run` stopped at an object literal that nothing uses, because one of its computed keys is a symbol. */
function stoppedAtAnUnusedLiteral(text: string, { stderr }: Ended) {
  const line = /Cannot convert a symbol to a string\n\s+at .*programs[\\/]\d+\.[a-z]+:(\d+):/.exec(stderr)?.[1];
  return line !== undefined && /^\s*\(\{/.test(text.split("\n")[Number(line) - 1] ?? "");
}

/** What a stopped build said, without the numbers and the names that differ from build to build. */
const wordsOf = (reason: string) => reason.replace(/[0-9a-f]/gi, "");

/**
 * The fewest of `texts`, found by halves, whose build stops with the words of `reason`. For a build that stopped and named no program.
 * Returns their indexes, or none when neither the kernel's nor the clock's end of a build can be asked again.
 */
async function programsThatStopTheBuild(texts: string[], extension: string, reason: string, mode?: string[]) {
  if (/^SIG(?:KILL|TERM): /.test(reason)) return [];
  const subset = join(work, `stops-${process.pid}`);
  const stops = async (indexes: number[]) => {
    const inGroup = Math.min(groupSize, indexes.length);
    layOut(
      subset,
      indexes.map(index => texts[index]),
      extension,
      inGroup,
    );
    const { stopped } = await build(subset, indexes.length, extension, inGroup, mode);
    return stopped !== undefined && wordsOf(stopped.reason) === wordsOf(reason);
  };
  let suspects = texts.map((_, index) => index);
  while (suspects.length > 1) {
    const halves = [suspects.slice(0, suspects.length >> 1), suspects.slice(suspects.length >> 1)];
    let kept: number[] | undefined;
    for (const half of halves) if (!kept && (await stops(half))) kept = half;
    if (!kept) break;
    suspects = kept;
  }
  rmSync(subset, { recursive: true, force: true });
  return suspects;
}

/** Waits until it has `count` programs. A rename decides which of several processes gets a file. */
async function takePrograms(): Promise<string[]> {
  const claimed = join(work, `claimed-${process.pid}`);
  rmSync(claimed, { recursive: true, force: true });
  mkdirSync(claimed, { recursive: true });
  const paths: string[] = [];
  for (;;) {
    for (const name of readdirSync(source).filter(name => /\.[cm]?[jt]s$/.test(name))) {
      try {
        if (options.keep) copyFileSync(join(source, name), join(claimed, name));
        else renameSync(join(source, name), join(claimed, name));
        paths.push(join(claimed, name));
      } catch {}
      if (paths.length === count) return paths;
    }
    if (options.keep && paths.length) return paths;
    await Bun.sleep(100);
  }
}

/** `// @ts-ignore` above every line of the TypeScript files of a program that has no such comment above it. The comment counts only where the line below it has an error. */
function ignoreTypeErrors(text: string) {
  return text
    .split(/^(?=\/\/ @filename: )/m)
    .map(file => {
      const name = /^\/\/ @filename: (\S+)/.exec(file)?.[1] ?? ".ts";
      if (!/\.[cm]?ts$/.test(name) || /\.d\.[cm]?ts$/.test(name)) return file;
      const lines: string[] = [];
      for (const line of file.split("\n")) {
        const [indentation] = /^\s*/.exec(line)!;
        const isCode = indentation.length < line.length && !line.startsWith("//", indentation.length);
        if (isCode && !lines.at(-1)?.trimStart().startsWith("// @ts-")) lines.push(indentation + "// @ts-ignore");
        lines.push(line);
      }
      return lines.join("\n");
    })
    .join("");
}

/** The program as the batch takes it. What is drawn depends on the text alone, and a find holds the text that was built. */
function rewritten(text: string, extension: string) {
  const random = randomFrom("rewritten" + text);
  const isTypeScript = extension.endsWith("ts");
  // `bun run` turns an object literal that nothing uses into its computed keys, each made a string, which throws where a key is a symbol. As the operand of a call the literal stays.
  text = text.replace(/^(\s*)\((\{ \[.*)\);$/gm, "$1Object($2);");
  // Such scenes bring files of their own, and the splitter knows only functions that end in a line of their own.
  const hasSizes = random() * 100 < Number(options["scenes-of-every-size"]);
  if (hasSizes) text = writeScenesOfEverySize(text, isTypeScript);
  else if (random() * 100 < Number(options["ordinary-scenes"]))
    text = writeOrdinaryScenes(text, isTypeScript, options.scene || undefined);
  if (random() * 100 < Number(options["one-scene"])) text = keepOneScene(text);
  if (random() * 100 < Number(options["hands-over-built-ins"])) text = handOverBuiltIns(text, isTypeScript);
  if (random() * 100 < Number(options["hooks-fail"])) text = endHooksInErrors(text, isTypeScript);
  if (random() * 100 < Number(options["names-of-globals"])) text = giveNamesOfGlobals(text);
  if (random() * 100 < Number(options["unwraps-try-blocks"])) text = unwrapTryBlocks(text);
  if (random() * 100 < Number(options["prints-members"])) text = printMembersOfObjects(text, isTypeScript);
  if (random() * 100 < Number(options["prints-into-a-text"])) text = keepWhatIsPrintedInAText(text, isTypeScript);
  if (!hasSizes && random() * 100 < Number(options.splits)) {
    // The splitter erases the types of a part, which fails where it has cut a scene in the wrong place. The program stays whole then.
    try {
      text = splitIntoFiles(text, extension);
    } catch {}
  }
  if (launders) text = launderValues(text, isTypeScript, random);
  if (isTypeScript && random() * 100 < Number(options["ignores-type-errors"])) text = ignoreTypeErrors(text);
  return text;
}

type Family = (
  seed: number,
  bed: unknown,
) => { text: string; extension: string; flags?: string[]; standsAlone?: true } | undefined;
/** The sources of ../sources.ts. */
let families: [string, Family][] | undefined;
const bedThatTakesEverything = { name: "product", binary: "", accepts: () => true, allows: () => true, batch: 1 };

const isAModule = (text: string) => /^(?:import|export)\b/m.test(text);

/** `count` programs with the extension, as the batch takes them. */
async function drawPrograms(extension: string) {
  const texts: string[] = [];
  const share = Number(options.families);
  if (share > 0 && !families) {
    const { allSources } = await import("../sources.ts");
    families = Object.entries(await allSources(join(import.meta.dir, "..", "..", "parallel"), new Set())) as [
      string,
      Family,
    ][];
  }
  while (texts.length < count) {
    const seed = Math.floor(Math.random() * 2 ** 48);
    if (Math.random() * 100 >= share) {
      texts.push(rewritten(`const printValue = console.log;\n// ${seed.toString(36)}\nexport {};\n`, extension));
      continue;
    }
    const [name, family] = families![seed % families!.length];
    let drawn: ReturnType<Family>;
    try {
      drawn = family(seed % 2 ** 31, bedThatTakesEverything);
    } catch {}
    if (!drawn || "." + drawn.extension !== extension || drawn.flags?.length || drawn.standsAlone) continue;
    // As the bed of those sources does: a text is a module unless it says that it stays a script.
    const isAScript = !isAModule(drawn.text) && !drawn.text.startsWith("// stays a script\n");
    const text = `${drawn.text}\n${isAScript ? "export {};\n" : ""}// ${name} ${seed % 2 ** 31}\n`;
    texts.push(launders ? launderValues(text, extension.endsWith("ts"), randomFrom("laundered" + text)) : text);
  }
  return texts;
}

/** What the programs of an entry point printed, cut at the marks behind them, and what came behind the last mark. */
function partsOf(output: string) {
  const pieces = output.split(new RegExp(`\\n${markBetween} (\\d+)\\n`));
  const ofProgram = new Map<number, string>();
  for (let at = 0; at + 1 < pieces.length; at += 2)
    ofProgram.set(Number(pieces[at + 1]), removeDetailsOfErrors(pieces[at]));
  return { ofProgram, rest: removeDetailsOfErrors(pieces.at(-1)!) };
}

/** Programs that wait for a batch in which each is an entry point. */
const waitingForABatchOfTheirOwn: string[] = [];
/** The programs that stood around such a program in its entry point and printed the same both ways. */
const neighborsOf = new Map<string, { before: string[]; behind: string[] }>();

/** Runs the entry points of the executable in `folder`, each of which imports up to `inEntryPoint` programs, and the same files under `bun run`. */
async function runTogether(
  folder: string,
  entryPoints: number[],
  extension: string,
  inEntryPoint: number,
  patience = 1,
) {
  const limit = (milliseconds * 4 + 20 * inEntryPoint) * patience;
  const [compiled, plain] = await Promise.all([
    run("compiled", [join(folder, "batch")], folder, extension, 1, entryPoints, limit),
    run("plain", [bun, "run", "./" + runner], folder, extension, 1, entryPoints, limit, plainEnv),
  ]);
  return { compiled, plain };
}

/** What the program at `position` prints both ways when one entry point imports `texts` in this order, if that differs. A text that says which run was stopped when one didn't get that far within its limits. */
async function differsTogether(folder: string, texts: string[], extension: string, position: number) {
  layOut(folder, texts, extension, 1, [texts.map((_, index) => index)]);
  const { writesToBuiltins } = await build(folder, 1, extension, 1, undefined, texts.length);
  if (!existsSync(join(folder, "batch"))) return undefined;
  // Behind a program that ends in an error stands no mark.
  const ofTheProgram = (ran: Map<number, Ended>) => {
    const { ofProgram, rest } = partsOf(ran.get(0)!.stdout);
    return ofProgram.get(position) ?? (ofProgram.size === position ? rest : undefined);
  };
  // A run that is stopped at a limit says nothing about the programs behind the one it was stopped in. It gets more time once.
  const wasStopped = (ran: { compiled: Map<number, Ended>; plain: Map<number, Ended> }) =>
    isLimit(ran.compiled.get(0)!) || isLimit(ran.plain.get(0)!);
  const howItWasStopped = (ran: { compiled: Map<number, Ended>; plain: Map<number, Ended> }) =>
    isLimit(ran.plain.get(0)!)
      ? "bun run is stopped"
      : `only the executable is stopped, by ${ran.compiled.get(0)!.end},`;
  const runBoth = async () => {
    const ran = await runTogether(folder, [0], extension, texts.length);
    return wasStopped(ran) ? await runTogether(folder, [0], extension, texts.length, 8) : ran;
  };
  const first = await runBoth();
  if (wasStopped(first)) return howItWasStopped(first);
  const [printed, expected] = [ofTheProgram(first.compiled), ofTheProgram(first.plain)];
  if (expected === undefined || printed === expected) return undefined;
  // A difference counts when a second pair of runs shows the same one.
  const second = await runBoth();
  if (wasStopped(second)) return howItWasStopped(second);
  return ofTheProgram(second.compiled) === printed && ofTheProgram(second.plain) === expected
    ? { compiled: printed ?? "", plain: expected, isBesideAWriteToABuiltIn: writesToBuiltins.size > 0 }
    : undefined;
}

const listed = (texts: string[]) => texts.map((text, offset) => `// ---- ${offset}\n${text}`).join("\n");

/**
 * The batch with `together` programs to an entry point. The programs that print the same both ways are done.
 * The others wait for a batch in which each is an entry point: there the differences that are documented are told from the rest.
 */
async function judgeTogether(texts: string[], extension: string, add: (kind: string, by?: number) => void) {
  const folder = join(work, `batch-${process.pid}`);
  // A text that shows neither kind of module becomes an ES module.
  texts = texts.map(text =>
    isAModule(text) || /\b(?:require|module|exports)\b|^["']use strict["']/m.test(text)
      ? text
      : text + "\nexport {};\n",
  );
  // An error that nobody catches ends the entry point, and so does a program that never ends. What `bun run` makes of each program alone tells.
  layOut(folder, texts, extension, 1);
  const everyProgram = texts.map((_, index) => index);
  const alone = await run(
    "alone",
    [bun, "run", "./" + runner],
    folder,
    extension,
    1,
    everyProgram,
    milliseconds,
    plainEnv,
  );
  // A program that ends in an error is the last of its entry point. One that doesn't end in time has an entry point to itself later.
  // A file that `bun run` refuses to read takes every program of its entry point with it: none of them runs.
  const isRefused = (text: string, { stdout, stderr }: Ended) =>
    stdout.trim() === "" && isRefusedByBunRun(text, stderr);
  const read = texts.flatMap((text, index) =>
    isRefused(text, alone.get(index)!) ? [] : [{ text, end: alone.get(index)!.end }],
  );
  add("bun run refuses the file", texts.length - read.length);
  add("taken", read.length - texts.length);
  let programs = read;
  for (const { end } of programs)
    if (end !== "0") add(`ends under bun run with: ${end.replace(/^the process ended.*/, "the process")}`);
  // In which order `bun run` runs several CommonJS files that a module imports differs from run to run.
  const scripts = programs.filter(({ text }) => !isAModule(text) || /^\/\/ @filename: \S+\.cjs$/m.test(text));
  add("is no module, or brings a CommonJS file", scripts.length);
  waitingForABatchOfTheirOwn.push(...scripts.map(({ text }) => text));
  programs = programs.filter(each => !scripts.includes(each));
  const canBeLast = ({ end }: { end: string }) => end === "error" || /^[1-9]\d*$/.test(end);
  if (takesOnlyThrowers) {
    const throwers = programs.filter(canBeLast);
    add("ends in an error and waits for a batch of such", throwers.length);
    add("taken", throwers.length + scripts.length - read.length);
    waitingForABatchOfTheirOwn.push(...throwers.map(({ text }) => text));
    return;
  }
  const onTheirOwn = programs.filter(each => each.end !== "0" && !canBeLast(each));
  const kept = onTheirOwn.filter(({ end }) => end !== "time" || Math.random() * 100 < Number(options.slow));
  add("does not end in time and is left out", onTheirOwn.length - kept.length);
  add("taken", kept.length - onTheirOwn.length);
  waitingForABatchOfTheirOwn.push(...kept.map(({ text }) => text));
  programs = programs.filter(each => each.end === "0" || canBeLast(each));
  const taken = programs.filter(each => each.end === "0" || Math.random() * 100 < Number(options.throwers));
  add("ends in an error and is left out", programs.length - taken.length);
  add("taken", taken.length - programs.length);
  programs = taken;
  let entryPoints: number[][] = [];
  const howTheyAreLaidOut = `${together} to an entry point that imports them with import statements`;
  for (;;) {
    entryPoints = [[]];
    let fit = 0;
    for (; fit < programs.length; fit++) {
      if (entryPoints.at(-1)!.length === together || (fit > 0 && programs[fit - 1].end !== "0")) {
        if (entryPoints.length === maxEntryPoints) break;
        entryPoints.push([]);
      }
      entryPoints.at(-1)!.push(fit);
    }
    add("more than a build takes", programs.length - fit);
    programs.length = fit;
    texts = programs.map(({ text }) => text);
    if (texts.length === 0) return;
    layOut(folder, texts, extension, 1, entryPoints);
    const { refused, stopped, ...built } = await build(
      folder,
      entryPoints.length,
      extension,
      1,
      undefined,
      texts.length,
    );
    if (stopped) {
      keepFind("build-stopped", stopped.reason, {
        ["program" + extension]: stopped.culprit === undefined ? "" : texts[stopped.culprit],
        "programs.txt": listed(texts),
        "report.txt": `${stopped.reason}\n${bun} build --compile --aot ${buildFlags.join(" ")}\nprograms.txt holds the ${texts.length} programs of the build, ${howTheyAreLaidOut}, and the program is number ${stopped.culprit ?? 0} in it\n`,
        "compiler.stderr": stopped.stderr,
        ...(stopped.machine === undefined ? {} : { "machine.txt": stopped.machine }),
      });
      add("stopped the build");
      // Each of them as an entry point says which one it was.
      if (stopped.culprit === undefined) {
        waitingForABatchOfTheirOwn.push(...texts);
        return;
      }
      refused.add(stopped.culprit);
    }
    if (refused.size) {
      add("builds that made no executable");
      add("refused", refused.size - (stopped ? 1 : 0));
      for (const reason of built.reasonsOfRefusals ?? []) add(`refused: ${reason}`);
      programs = programs.filter((_, index) => !refused.has(index));
      continue;
    }
    if (built.areOneProgram && built.openers?.length && !launders) {
      const openers = new Set(built.openers);
      add("builds that programs opened");
      add("opens the world", openers.size);
      waitingWithTheWorldOpen.push(...texts.filter((_, index) => openers.has(index)));
      programs = programs.filter((_, index) => !openers.has(index));
      continue;
    }
    if (built.areOneProgram !== undefined)
      add(built.areOneProgram ? "executables that are one program" : "executables with a program for each group");
    if (built.areOneProgram) add(`one program and none is named: ${built.reasons}`);
    break;
  }
  const everyEntryPoint = entryPoints.map((_, entryPoint) => entryPoint);
  const { compiled, plain } = await runTogether(folder, everyEntryPoint, extension, together);
  const printedTheSame = new Set<number>();
  for (const entryPoint of everyEntryPoint) {
    const members = entryPoints[entryPoint];
    const last = members.at(-1)!;
    const [left, right] = [compiled.get(entryPoint)!, plain.get(entryPoint)!];
    const [printed, expected] = [partsOf(left.stdout), partsOf(right.stdout)];
    let differing = members.filter(index => printed.ofProgram.get(index) !== expected.ofProgram.get(index));
    // What is printed behind the last mark comes from a program that ends in an error, or from jobs and timers of any of them.
    if (differing.length === 0 && (left.end !== right.end || printed.rest !== expected.rest))
      differing = programs[last].end === "0" ? members : [last];
    add(
      "did not run beside the others",
      members.filter(index => !expected.ofProgram.has(index) && programs[index].end === "0").length,
    );
    add("same", members.length - differing.length);
    add("prints something else beside the others", differing.length);
    const same = members.filter(index => !differing.includes(index));
    for (const index of same) printedTheSame.add(index);
    for (const index of differing) {
      waitingForABatchOfTheirOwn.push(texts[index]);
      neighborsOf.set(texts[index], {
        before: same.filter(other => other < index).map(other => texts[other]),
        behind: same.filter(other => other > index).map(other => texts[other]),
      });
    }
  }
  if (Math.random() * 100 < Number(options.collects))
    await judgeUnderCollections(
      folder,
      texts,
      extension,
      1,
      everyEntryPoint,
      entryPoint => entryPoints[entryPoint],
      true,
      compiled,
      printedTheSame,
      milliseconds * 16 + 80 * together,
      add,
    );
  if (Math.random() * 100 < Number(options["ends-early"]))
    await judgeEndedEarly(
      folder,
      texts,
      extension,
      1,
      everyEntryPoint,
      entryPoint => entryPoints[entryPoint],
      compiled,
      add,
    );
  if (Math.random() * 100 < Number(options.validates)) {
    const flags = [...buildFlags, "--aot-validate"];
    const command = `${bun} build --compile --aot ${flags.join(" ")}`;
    const { stopped, refused } = await build(
      folder,
      entryPoints.length,
      extension,
      1,
      ["--aot", ...flags],
      texts.length * 2,
    );
    if (stopped) {
      add("stopped the validating build");
      keepFind("validating-build-stopped", stopped.reason, {
        ["program" + extension]: stopped.culprit === undefined ? "" : texts[stopped.culprit],
        "programs.txt": listed(texts),
        "report.txt": `${stopped.reason}\n${command}\nprograms.txt holds the ${texts.length} programs of the build, ${howTheyAreLaidOut}, and the program is number ${stopped.culprit ?? 0} in it\n`,
        "compiler.stderr": stopped.stderr,
        ...(stopped.machine === undefined ? {} : { "machine.txt": stopped.machine }),
      });
    } else if (refused.size === 0) {
      const limit = milliseconds * 16 + 80 * together;
      const validated = await run("validating", [join(folder, "batch")], folder, extension, 1, everyEntryPoint, limit);
      for (const entryPoint of everyEntryPoint) {
        const ended = validated.get(entryPoint)!;
        const said = /^.*\bAOT (?:validation|native call)\b.*$/m.exec(ended.stderr)?.[0];
        if (said === undefined) continue;
        add("validation");
        // The program behind the last mark.
        const members = entryPoints[entryPoint].map(index => texts[index]);
        const position = partsOf(ended.stderr).ofProgram.size;
        keepFind("validation", said.replace(/\b[a-z]\d+\b/g, "_"), {
          ["program" + extension]: members[position] ?? "",
          "programs.txt": listed(members),
          "report.txt": `validation, one of ${members.length} programs that an entry point imports with import statements, number ${position}\n${command}\n${said}\n`,
          "compiled.stderr": ended.stderr,
        });
      }
    }
  }
  rmSync(folder, { recursive: true, force: true });
}

/** A program that printed something else beside its neighbors and prints the same as an entry point of its own goes back among those of them that printed the same. */
async function askAmongNeighbors(text: string, extension: string, add: (kind: string, by?: number) => void) {
  const around = neighborsOf.get(text);
  if (!around) return;
  // What a module prints behind an `await` at its top level can come behind the mark, or behind a neighbor's. When it comes differs from run to run, under `bun run` too.
  const awaits = (program: string) => /\bawait\b/.test(program);
  if (awaits(text)) {
    add("awaits, and prints something else only beside the others");
    return;
  }
  const subset = join(work, `subset-${process.pid}`);
  let [before, behind] = [around.before, around.behind].map(programs => programs.filter(each => !awaits(each)));
  const ask = (before: string[], behind: string[]) =>
    differsTogether(subset, [...before, text, ...behind], extension, before.length);
  let difference = await ask(before, behind);
  if (typeof difference === "string") {
    add(`${difference} at a limit among the neighbors`);
    if (difference.startsWith("only the executable"))
      keepFind("limit", `among the neighbors: ${difference}`, {
        ["program" + extension]: text,
        "neighbors.txt": listed([...before, text, ...behind]),
        "report.txt": `limit\n${bun} build --compile --aot ${buildFlags.join(" ")}\n${difference} with 8 times the time too, and bun run is not: one entry point imports the ${before.length + 1 + behind.length} programs of neighbors.txt in that order with import statements, and the program is number ${before.length}\n`,
      });
    difference = undefined;
  } else if (difference && withoutLayout(difference.compiled) === withoutLayout(difference.plain)) {
    add("function text");
    difference = undefined;
  } else add(difference ? "among-neighbors" : "prints something else only beside a program that does too");
  if (difference) {
    // What runs behind the program seldom counts, and of what runs before it one half is often enough.
    for (let shrank = true; shrank && before.length + behind.length > 0; ) {
      shrank = false;
      const fewer: [string[], string[]][] = [
        [before, []],
        [before, behind.slice(0, behind.length >> 1)],
        [before, behind.slice(behind.length >> 1)],
        [before.slice(before.length >> 1), behind],
        [before.slice(0, before.length >> 1), behind],
      ];
      for (const [fewerBefore, fewerBehind] of fewer) {
        if (fewerBefore.length + fewerBehind.length === before.length + behind.length) continue;
        const still = await ask(fewerBefore, fewerBehind);
        if (!still || typeof still === "string") continue;
        [before, behind, difference, shrank] = [fewerBefore, fewerBehind, still, true];
        break;
      }
    }
    const summary = firstDifference(difference.compiled, difference.plain);
    // The programs of an entry point share a realm. An executable refuses a write to a built-in, so only under `bun run` do the neighbors see it.
    if (difference.isBesideAWriteToABuiltIn) add("among neighbors of which one writes to a built-in");
    else
      keepFind("among-neighbors", summary, {
        ["program" + extension]: text,
        "neighbors.txt": listed([...before, text, ...behind]),
        "report.txt": `among-neighbors\n${bun} build --compile --aot ${buildFlags.join(" ")}\n${summary}DIFFERS ONLY AMONG NEIGHBORS: one entry point imports the ${before.length + 1 + behind.length} programs of neighbors.txt in that order with import statements, and the program is number ${before.length}\n`,
        "compiled.stdout": difference.compiled,
        "bun-run.stdout": difference.plain,
      });
  }
  rmSync(subset, { recursive: true, force: true });
}

/**
 * The executable in `folder` three times more. The runner ends the Worker of each unit at a moment that it draws from a span of a few milliseconds, whatever the program is doing then.
 * Nothing that is printed counts. A process that ends by a signal is kept, with what `bun run` of the same files does in as many runs.
 */
async function judgeEndedEarly(
  folder: string,
  texts: string[],
  extension: string,
  inGroup: number,
  units: number[],
  membersOf: (unit: number) => number[],
  atDefault: Map<number, Ended>,
  add: (kind: string, by?: number) => void,
) {
  const spans = [1, 2, 4, 8, 16, 32, 64, 128, 256];
  const span = spans[Math.floor(Math.random() * spans.length)];
  // Several Workers at the same time start and end beside each other, and under collections the end of one meets the collector.
  const atOnce = [1, 1, 2, 4, 8][Math.floor(Math.random() * 5)];
  const environment: Record<string, string> = {
    BATCH_ENDS_WITHIN: String(span),
    BATCH_AT_ONCE: String(atOnce),
    ...(Math.random() < 0.5 ? drawCollections() : {}),
  };
  const words = Object.entries(environment)
    .map(([name, value]) => `${name}=${value}`)
    .join(" ");
  const runSo = (stage: string, command: string[], which: number[], more: Record<string, string> = {}) =>
    run(stage, command, folder, extension, inGroup, which, milliseconds * 4, { ...environment, ...more });
  const endedBySignal = ({ end }: Ended) => /^the process ended: SIG(?!KILL|TERM)/.test(end);
  const calm = units.filter(unit => !atDefault.get(unit)!.end.startsWith("the process ended"));
  const blamed = new Map<number, Ended>();
  for (let round = 0; round < 3; round++)
    for (const [unit, ended] of await runSo("ending-early", [join(folder, "batch")], calm))
      if (endedBySignal(ended) && !blamed.has(unit)) blamed.set(unit, ended);
  add(`Workers ended within ${span} ms`, calm.length * 3);
  add(
    `Workers ended early, ${atOnce} at once${Object.keys(environment).length > 2 ? ", under collections" : ""}`,
    calm.length * 3,
  );
  for (const [unit, ended] of [...blamed].slice(0, 3)) {
    // The thread of a Worker that was ended can outlive its mark, so the units in front of the blamed one count too, and those that ran beside it.
    const at = calm.indexOf(unit);
    const suspects = calm.slice(Math.max(0, at - 3), at + atOnce);
    let plainEndsSo = false;
    for (let round = 0; round < 3 && !plainEndsSo; round++)
      plainEndsSo = [
        ...(await runSo("plain-ending-early", [bun, "run", "./" + runner], suspects, plainEnv)).values(),
      ].some(endedBySignal);
    const kind = plainEndsSo ? "bun-run-ended-early-signal" : "ended-early-signal";
    add(kind);
    // The address differs from run to run. The code at the place does not.
    const where =
      /^Code at rip: .*$/m.exec(ended.stderr)?.[0] ??
      /^panic(?:\([^)\n]*\))?: .*$/m.exec(ended.stderr)?.[0].replace(/0x[0-9A-Fa-f]+/g, "<address>") ??
      "";
    keepFind(kind, `${ended.end} | ${where}`, {
      ["program" + extension]: texts[membersOf(unit)[0]],
      "programs.txt": listed(suspects.flatMap(membersOf).map(index => texts[index])),
      "report.txt": `${kind}\n${bun} build --compile --aot ${buildFlags.join(" ")}\n${ended.end} | ${where}\nThe runner ended each Worker at a moment within ${span} ms, ${atOnce} at once, in three runs: ${words}. programs.txt holds the programs of the entry point that gets the blame, of up to three in front of it, whose threads may still have been ending, and of those that ran beside it.\nbun run of the same files, three runs: ${plainEndsSo ? "a signal too" : "no signal"}\n`,
      "compiled.stderr": ended.stderr,
    });
  }
}

/** An environment in which an executable collects at every few allocations that leave the fast path, and overwrites what it frees. One interval is blind to what another sees. */
function drawCollections(): Record<string, string> {
  const pick = (list: number[]) => list[Math.floor(Math.random() * list.length)];
  const areYoung = Math.random() < 0.5;
  // Full collections at every second to fifth such allocation take a batch as long as its build. Young ones, and full ones at every seventh, take a tenth of that.
  const every = areYoung
    ? pick([1, 2, 3, 5, 7, 11, 13])
    : Math.random() < 0.1
      ? pick([2, 3, 5])
      : pick([7, 11, 13, 17, 23, 37]);
  return {
    BUN_JSC_slowPathAllocsBetweenGCs: String(every),
    BUN_JSC_scribbleFreeCells: "1",
    BUN_JSC_useZombieMode: "1",
    ...(areYoung && { BUN_JSC_useEdenCollectionsAtSlowPathAllocs: "1" }),
  };
}
/** What a program names when its output depends on when the collector runs. */
const namesTheCollector = /\b(?:WeakRef|FinalizationRegistry|heapStats|memoryUsage|resourceUsage|heapSize)\b|\bgc\(/;

/**
 * The executable in `folder` once more, under collections. A unit of the run is what `run` takes an index of, and `membersOf` lists the programs in it: with `hasMarks`, a mark stands behind each.
 * `atDefault` is the first run of the executable. Only the programs in `judged` count, which printed there what they print under `bun run`.
 */
async function judgeUnderCollections(
  folder: string,
  texts: string[],
  extension: string,
  inGroup: number,
  units: number[],
  membersOf: (unit: number) => number[],
  hasMarks: boolean,
  atDefault: Map<number, Ended>,
  judged: Set<number>,
  limit: number,
  add: (kind: string, by?: number) => void,
) {
  const environment = drawCollections();
  const words = Object.entries(environment)
    .map(([name, value]) => `${name}=${value}`)
    .join(" ");
  add(
    `collections at every ${environment.BUN_JSC_slowPathAllocsBetweenGCs}, ${environment.BUN_JSC_useEdenCollectionsAtSlowPathAllocs ? "young" : "full"}`,
  );
  const executable = [join(folder, "batch")];
  const runSo = (stage: string, command: string[], which: number[], more: Record<string, string> = {}) =>
    run(stage, command, folder, extension, inGroup, which, limit, { ...environment, ...more });
  const gaveUp = (ended: Ended) =>
    isLimit(ended) || wasKilled(ended) || reservedTooManyAddresses(ended) || ended.end === "the process ended: SIGTERM";
  const printedBy = (ended: Ended, members: number[]) =>
    hasMarks ? partsOf(ended.stdout).ofProgram : new Map([[members[0], removeDetailsOfErrors(ended.stdout)]]);
  const collected = await runSo("collecting", executable, units);
  for (const unit of units) {
    const [ended, before, members] = [collected.get(unit)!, atDefault.get(unit)!, membersOf(unit)];
    if (gaveUp(before) || before.end.startsWith("the process ended")) continue;
    if (gaveUp(ended)) {
      add("did not end under collections", members.length);
      continue;
    }
    const endedEarly = ended.end.startsWith("the process ended");
    const [now, then] = [printedBy(ended, members), printedBy(before, members)];
    // A process that ends early was in the program behind the last mark.
    let suspects = endedEarly
      ? [members[hasMarks ? now.size : 0] ?? members.at(-1)!]
      : members.filter(index => judged.has(index) && now.get(index) !== then.get(index));
    if (!endedEarly && suspects.length === 0 && ended.end !== before.end && judged.has(members.at(-1)!))
      suspects = [members.at(-1)!];
    add("same under collections", members.length - suspects.length);
    if (!endedEarly) {
      add("names the collector", suspects.filter(index => namesTheCollector.test(texts[index])).length);
      suspects = suspects.filter(index => !namesTheCollector.test(texts[index]));
    }
    if (suspects.length === 0) continue;
    // What `bun run` makes of the same files in the same environment, and the executable a second time.
    const plain = (await runSo("plain-collecting", [bun, "run", "./" + runner], [unit], plainEnv)).get(unit)!;
    const again = (await runSo("collecting", executable, [unit])).get(unit)!;
    const [expected, second] = [printedBy(plain, members), printedBy(again, members)];
    if (!endedEarly && !gaveUp(plain)) {
      const alike = suspects.filter(index => expected.get(index) === now.get(index));
      add("bun run prints that under collections too", alike.length);
      suspects = suspects.filter(index => !alike.includes(index));
    }
    if (!endedEarly) {
      // A program that prints the time of day prints another one a second later.
      const withoutTimes = (text = "") =>
        text.replace(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b|\b1[6-9]\d{11}(?:\.\d+)?\b/g, "<time>");
      const timely = suspects.filter(index => withoutTimes(now.get(index)) === withoutTimes(then.get(index)));
      add("prints another time of day under collections", timely.length);
      suspects = suspects.filter(index => !timely.includes(index));
    }
    for (const index of suspects.slice(0, 3)) {
      const kind = !endedEarly
        ? "collections-stdout"
        : plain.end.startsWith("the process ended") && !gaveUp(plain)
          ? "bun-run-collections-signal"
          : "collections-signal";
      add(kind);
      const [left, right] = [(now.get(index) ?? "").split("\n"), (then.get(index) ?? "").split("\n")];
      const differs = left.findIndex((line, at) => line !== right[at]);
      const line = differs < 0 ? left.length : differs;
      const lastWords = [/^panic(?:\([^)\n]*\))?: .*$/m, /([^\n]*)\n={20,}\n/]
        .map(pattern => pattern.exec(ended.stderr)?.at(-1))
        .filter(Boolean)
        .join(" | ");
      const summary = endedEarly
        ? `under collections: ${ended.end}${lastWords && " | " + lastWords}\nwithout:           ${before.end}\n`
        : `under collections: ${ended.end} ${(left[line] ?? "").slice(0, 400)}\nwithout:           ${before.end} ${(right[line] ?? "").slice(0, 400)}\n`;
      const isSteady = endedEarly ? again.end === ended.end : second.get(index) === now.get(index);
      keepFind(kind, summary, {
        ["program" + extension]: texts[index],
        ...(members.length > 1 && { "programs.txt": listed(members.map(member => texts[member])) }),
        "report.txt": `${kind}, ${
          hasMarks
            ? `one of ${members.length} programs that an entry point imports with import statements, number ${members.indexOf(index)}`
            : `one of ${texts.length} programs in groups of ${inGroup}`
        }\n${bun} build --compile --aot ${buildFlags.join(" ")}\nthe executable runs with ${words}\n${summary}a second run in that environment: ${isSteady ? "the same" : `something else, and it ends with ${again.end}`}\nbun run in that environment: ${plain.end}\n`,
        "collecting.stdout": ended.stdout,
        "collecting.stderr": ended.stderr,
        "compiled.stdout": before.stdout,
        "bun-run-collecting.stdout": plain.stdout,
        "bun-run-collecting.stderr": plain.stderr,
      });
    }
  }
}

let extension = "";
const lastStart = Number(options.seconds) ? performance.now() + Number(options.seconds) * 1000 : Infinity;
for (
  let batch = 0;
  performance.now() < lastStart &&
  (batches === 0 || batch < batches || waitingWithTheWorldOpen.length || waitingForABatchOfTheirOwn.length);
  batch++
) {
  for (const stage in spent) delete spent[stage];
  const started = performance.now();
  count = countsOfPrograms[batch % countsOfPrograms.length];
  const isBehindTheLast = batches !== 0 && batch >= batches;
  // With several programs to an entry point, a batch in which each is one holds as many as a build takes.
  // With the world open each entry point holds much of the library, and the checks take four times as long.
  const atOnce = together > 1 ? Math.min(count, launders ? 24 : maxEntryPoints) : count;
  const areOnTheirOwn =
    waitingForABatchOfTheirOwn.length >= atOnce || (isBehindTheLast && waitingForABatchOfTheirOwn.length > 0);
  const haveTheWorldOpen = !areOnTheirOwn && (waitingWithTheWorldOpen.length >= atOnce || isBehindTheLast);
  let texts = areOnTheirOwn
    ? waitingForABatchOfTheirOwn.splice(0, atOnce)
    : waitingWithTheWorldOpen.splice(0, haveTheWorldOpen ? atOnce : 0);
  if (!haveTheWorldOpen && !areOnTheirOwn) {
    if (options.draws) {
      extension = "." + options.draws;
      for (const text of await drawPrograms(extension))
        if (bringsItsOwnTsconfigUnderTheDrawnOne(text)) leftOutUnderTheDrawnTsconfig++;
        else
          (isWrittenToOpenTheWorld(text) && !launders ? waitingWithTheWorldOpen : texts).push(
            withTheOptionsOfTheProject(text, extension),
          );
    } else {
      const paths = await takePrograms();
      extension = extname(paths[0]);
      for (const path of paths) {
        const text = withTheOptionsOfTheProject(rewritten(readFileSync(path, "latin1"), extension), extension);
        (isWrittenToOpenTheWorld(text) && !launders ? waitingWithTheWorldOpen : texts).push(text);
        rmSync(path, { force: true });
      }
    }
    if (texts.length === 0) continue;
  }
  const folder = join(work, `batch-${process.pid}`);
  // A program that waited was counted by the batch that took it.
  const counts: Record<string, number> = { taken: areOnTheirOwn ? 0 : texts.length };
  const add = (kind: string, by = 1) => {
    if (by) counts[kind] = (counts[kind] ?? 0) + by;
  };
  if (areOnTheirOwn) add("each an entry point now", texts.length);
  add("brings a tsconfig.json of its own under the drawn one and is left out", leftOutUnderTheDrawnTsconfig);
  leftOutUnderTheDrawnTsconfig = 0;
  const sayWhatTheBatchDid = () => {
    const cpuSeconds = Object.values(spent).reduce((sum, stage) => sum + stage.cpuSeconds, 0);
    const stages = Object.entries(spent).map(
      ([stage, { cpuSeconds, wallSeconds, peakMegabytes }]) =>
        `${stage} ${cpuSeconds.toFixed(1)} cpu-s ${wallSeconds.toFixed(1)} s ${peakMegabytes.toFixed(0)} MB`,
    );
    console.log(
      `${new Date().toISOString().slice(11, 19)} batch ${batch}: ${(counts.taken / cpuSeconds).toFixed(1)} programs a processor-second, ${(counts.taken / ((performance.now() - started) / 1000)).toFixed(1)} a second | ${stages.join(" | ")} | ${JSON.stringify(counts)}`,
    );
  };
  if (together > 1 && !haveTheWorldOpen && !areOnTheirOwn) {
    await judgeTogether(texts, extension, add);
    mkdirSync(finds, { recursive: true });
    if (batch % 20 === 0)
      writeFileSync(join(finds, `counters-${process.pid}.json`), JSON.stringify(Object.fromEntries(largestSeen)));
    sayWhatTheBatchDid();
    continue;
  }

  // The programs that the compiler refuses leave, and so does one that it stops at. The rest is built again.
  let writesToBuiltins = new Set<number>();
  for (;;) {
    layOut(folder, texts, extension, groupSize);
    const secondsBefore = spent["failed-build"]?.cpuSeconds ?? 0;
    const { refused, stopped, ...built } = await build(folder, texts.length, extension, groupSize);
    writesToBuiltins = built.writesToBuiltins;
    if (stopped || refused.size) {
      add("builds that made no executable");
      add("processor seconds in them", Math.round(spent["failed-build"].cpuSeconds - secondsBefore));
    }
    // keepFind() leaves out a build that its bound ended: on a busy machine that says nothing. A build that had a processor to itself for half a minute a program is another matter, where the programs are small:
    // there the compiler does not end. Some families write functions of a hundred thousand lines, whose builds take minutes.
    const secondsOfTheBuild = (spent["failed-build"]?.cpuSeconds ?? 0) - secondsBefore;
    if (
      stopped &&
      /^SIGKILL: the errors name no program$/.test(stopped.reason) &&
      secondsOfTheBuild >= 30 * texts.length &&
      texts.every(text => text.length < 200_000)
    )
      keepFind("build-does-not-end", "its bound ended the build", {
        ["program" + extension]: texts.length === 1 ? texts[0] : "",
        "programs.txt": texts.map((text, index) => `// ---- ${index}\n${text}`).join("\n"),
        "report.txt": `the build of ${texts.length} programs had used ${Math.round(secondsOfTheBuild)} processor-seconds when its bound ended it\n${bun} build --compile --aot ${buildFlags.join(" ")}\n`,
      });
    if (stopped) {
      // Halves of the batch say which programs it takes.
      const enough =
        stopped.culprit === undefined ? await programsThatStopTheBuild(texts, extension, stopped.reason) : [];
      if (enough.length === 1) stopped.culprit = enough[0];
      const listedPrograms =
        enough.length > 1 && enough.length < texts.length ? enough : texts.map((_, index) => index);
      keepFind("build-stopped", stopped.reason, {
        ["program" + extension]: stopped.culprit === undefined ? "" : texts[stopped.culprit],
        "programs.txt": listedPrograms.map((index, offset) => `// ---- ${offset}\n${texts[index]}`).join("\n"),
        "report.txt": `${stopped.reason}\n${bun} build --compile --aot ${buildFlags.join(" ")}\nprograms.txt holds ${listedPrograms.length} of the ${texts.length} programs of the build, in groups of ${groupSize}${enough.length > 1 ? ", which are enough to stop it" : enough.length ? ", of which one alone stops it" : ""}, and the program is number ${Math.max(0, listedPrograms.indexOf(stopped.culprit ?? -1))} in it\n`,
        "compiler.stderr": stopped.stderr,
        ...(stopped.machine === undefined ? {} : { "machine.txt": stopped.machine }),
      });
      add("stopped the build");
      if (stopped.culprit === undefined && (enough.length === 0 || enough.length === texts.length)) {
        add("in a build that stopped and named no program", texts.length);
        texts = [];
        break;
      }
      for (const index of stopped.culprit === undefined ? enough : [stopped.culprit]) refused.add(index);
    }
    if (refused.size) {
      if (!stopped) add("refused", refused.size);
      for (const reason of built.reasonsOfRefusals ?? []) add(`refused: ${reason}`);
      // A build reports the errors of the type checker. A program in a folder with a tsconfig.json is a project, which `bun check` checks as a whole.
      for (const index of refused) {
        // The folder of the program itself. A package below it can have a tsconfig.json of its own.
        const project = /^\/\/ @filename: \.\/([^/\s]+)\/tsconfig\.json$/m.exec(texts[index])?.[1];
        if (project === undefined || stopped) continue;
        // What a second entry point reaches is checked with the first entry point's answer to whether `undefined` and `null` belong to every type, and a group is a second entry point.
        if (/^ +"strict(?:NullChecks)?": false,?$/m.test(texts[index])) continue;
        // How far the checker reads the JavaScript of packages is the entry point's answer too.
        if (/^ +"maxNodeModuleJsDepth": [1-9]/m.test(texts[index])) continue;
        // An error with six digits is the compiler's own, about what cannot run, such as a regular expression that isn't valid.
        if (
          (built.errors ?? "")
            .split(/^(?=error)/m)
            .some(error => /^error: TS\d{6}\b/.test(error) && error.includes(project))
        )
          continue;
        const checked = await spawn("check", [bun, "check", "--no-pretty"], join(folder, "programs", project), {}, 60);
        // Below `// @ts-nocheck` the checker is silent about what no Bun can run, such as an assignment to a constant. A build without --aot refuses that too.
        let isRefusedWithoutAot = false;
        if (checked.exitCode === 0) {
          const alone = join(work, `alone-${process.pid}`);
          layOut(alone, [texts[index]], extension, 1);
          await build(alone, 1, extension, 1, []);
          isRefusedWithoutAot = !existsSync(join(alone, "batch"));
          rmSync(alone, { recursive: true, force: true });
        }
        add(
          checked.exitCode !== 0
            ? "refused by bun check too"
            : isRefusedWithoutAot
              ? "refused by a build without --aot too"
              : "refused though bun check accepts the project",
        );
        if (checked.exitCode === 0 && !isRefusedWithoutAot)
          keepFind("refused-though-checked", (built.reasonsOfRefusals ?? []).join(" "), {
            ["program" + extension]: texts[index],
            "report.txt": `the build refuses a program that bun check accepts, one of ${texts.length} programs in groups of ${groupSize}, number ${index}\n${bun} build --compile --aot ${buildFlags.join(" ")}\n`,
            "compiler.stderr": built.errors ?? "",
            "check.stdout": checked.stdout,
          });
      }
      texts = texts.filter((_, index) => !refused.has(index));
      continue;
    }
    // The program that made one program of all leaves for an executable of such programs.
    if (built.areOneProgram && built.openedBy !== undefined && !haveTheWorldOpen && !launders && texts.length > 1) {
      add("builds that one program opened");
      waitingWithTheWorldOpen.push(...texts.splice(built.openedBy, 1));
      counts.taken--;
      continue;
    }
    if (built.areOneProgram !== undefined)
      add(built.areOneProgram ? "executables that are one program" : "executables with a program for each group");
    if (built.areOneProgram && !haveTheWorldOpen) add(`one program and none is named: ${built.reasons}`);
    break;
  }
  const all = texts.map((_, index) => index);
  const runCompiled = (indexes: number[], limit: number) =>
    run("compiled", [join(folder, "batch")], folder, extension, groupSize, indexes, limit);
  const runPlain = (indexes: number[], limit: number) =>
    run("plain", [bun, "run", "./" + runner], folder, extension, groupSize, indexes, limit, plainEnv);
  // Both wait more than they compute, so they run at once. The pair that decides runs one after the other.
  const [compiled, plain] = await Promise.all([runCompiled(all, milliseconds), runPlain(all, milliseconds)]);
  const differing = all.filter(index => !agree(compiled.get(index)!, plain.get(index)!));
  add("same", all.length - differing.length);
  for (const index of all) {
    if (!differing.includes(index)) await askAmongNeighbors(texts[index], extension, add);
    neighborsOf.delete(texts[index]);
  }

  // A difference counts when a second pair of runs, with more time, shows it again.
  const [compiledAgain, plainAgain] = [
    await runCompiled(differing, milliseconds * 20),
    await runPlain(differing, milliseconds * 20),
  ];
  const ordinary = await runInOrdinaryExecutable(differing, texts, extension);
  let isolated = 0;
  for (const index of differing) {
    const [first, second, reference, referenceAgain] = [
      compiled.get(index)!,
      compiledAgain.get(index)!,
      plain.get(index)!,
      plainAgain.get(index)!,
    ];
    const inOrdinary = ordinary.get(index);
    const says = (message: string) => second.stderr.includes(message) || second.stdout.includes(message);
    const showsFunctionText = !hidesFunctionText && /function|=>|class /.test(referenceAgain.stdout + second.stdout);
    let kind =
      referenceAgain.end.startsWith("the process ended") &&
      !wasKilled(referenceAgain) &&
      !reservedTooManyAddresses(referenceAgain)
        ? "bun-run-signal"
        : isLimit(referenceAgain) || wasKilled(referenceAgain) || reservedTooManyAddresses(referenceAgain)
          ? "neither finished"
          : !isLimit(reference) && !agree(reference, referenceAgain)
            ? "bun run is unsteady"
            : agree(second, referenceAgain)
              ? isLimit(first) || isLimit(reference)
                ? "same with more time"
                : "unsteady"
              : second.end.startsWith("the process ended")
                ? "signal"
                : documentedMessages.some(says) ||
                    (!isLimit(second) && referenceAgain.stderr.includes("Maximum call stack size exceeded")) ||
                    documentedNames.some(name => texts[index].includes(name)) ||
                    texts[index].includes(saysThatPlainBunDiffers) ||
                    printsItsStoredOutput(texts[index], second) ||
                    differOnlyInDetails(texts[index], second, referenceAgain) ||
                    setsThePrototypeOfABuiltIn.test(texts[index]) ||
                    deletesTheLengthOfAString.test(texts[index]) ||
                    deletesACharacterOfAString.test(texts[index]) ||
                    (second.end === referenceAgain.end &&
                      withNullAsUndefined(second.stdout) === withNullAsUndefined(referenceAgain.stdout) &&
                      readsThisOfTheModule(texts[index])) ||
                    (second.end === referenceAgain.end &&
                      withoutNamesOfFunctions(second.stdout) === withoutNamesOfFunctions(referenceAgain.stdout) &&
                      hasALiteralAsComputedKey.test(texts[index])) ||
                    writesToBuiltins.has(index)
                  ? "documented difference"
                  : referenceAgain.stdout === "" && isRefusedByBunRun(texts[index], referenceAgain.stderr)
                    ? "bun run refuses the file"
                    : inOrdinary &&
                        hasATsconfigInAFolderOfItsOwn.test(texts[index]) &&
                        printsOnlyLinesOfEither(second, referenceAgain, inOrdinary)
                      ? "documented difference"
                      : inOrdinary &&
                          hasATsconfigInAFolderOfItsOwn.test(texts[index]) &&
                          lacksTheYardstickOfItsOwnOptions(second, referenceAgain, inOrdinary)
                        ? "options of its own, and the executable without --aot does not start"
                        : inOrdinary && agree(second, inOrdinary) && classOfError(second) === classOfError(inOrdinary)
                          ? "as an executable without --aot"
                          : showsFunctionText || agreeButForLayout(second, referenceAgain)
                            ? "function text"
                            : second.end === referenceAgain.end && definesAnAccessorTwice(texts[index])
                              ? "an accessor defined twice"
                              : isLimit(second)
                                ? "limit"
                                : second.end !== referenceAgain.end
                                  ? "exit-code"
                                  : removeDetailsOfErrors(second.stdout) !==
                                      removeDetailsOfErrors(referenceAgain.stdout)
                                    ? "stdout"
                                    : lastError(second).name !== lastError(referenceAgain).name
                                      ? "error-class"
                                      : "error-message";
    // A build warns about the first write to a built-in that it meets, so the build of a group names one program of several.
    if (["limit", "exit-code", "stdout", "error-class", "error-message"].includes(kind)) {
      const alone = join(work, `alone-${process.pid}`);
      layOut(alone, [texts[index]], extension, 1);
      const said = await withErrorsOfItsOwnExecutable(alone, extension, second);
      if ((await build(alone, 1, extension, 1)).writesToBuiltins.size) kind = "documented difference";
      else if (await printsTheDepthOfTheStack(alone, extension)) kind = "documented difference";
      else if (
        stoppedAtAnUnusedLiteral(texts[index], referenceAgain) ||
        (!referenceAgain.stderr.includes("ReferenceError") && (await stoppedAtANameThatDoesNotExist(alone, said)))
      )
        kind = "documented difference";
      else if (!hidesFunctionText && (await printsFromTheTextOfFunctions(alone, extension))) kind = "function text";
      else if (
        readsThisOfTheModule(texts[index]) &&
        (await agreesWithUndefinedAsThisOfTheModule(alone, extension, texts[index], second))
      )
        kind = "documented difference";
      else if (
        withKeysConvertedBeforeValues(texts[index]) !== texts[index] &&
        (await agreesWithKeysConvertedBeforeValues(alone, extension, texts[index], second))
      )
        kind = "documented difference";
      else if (await stoppedAtAnUnusedReadBeforeTheDeclaration(alone, extension, texts[index], said, referenceAgain))
        kind = "documented difference";
      else if (await agreesButForFunctionsDeclaredInBlocks(alone, extension, texts[index], second, referenceAgain))
        kind = "documented difference";
      rmSync(alone, { recursive: true, force: true });
    }
    add(kind);
    if (
      ![
        "bun-run-signal",
        "unsteady",
        "signal",
        "limit",
        "exit-code",
        "stdout",
        "error-class",
        "error-message",
        ...alsoKept,
      ].includes(kind)
    )
      continue;
    // What the process wrote last, in front of the report that starts with a line of "=", tells one end by a signal from another.
    const lastWords = kind === "signal" ? (/([^\n]*)\n={20,}\n/.exec(second.stderr)?.[1] ?? "") : "";
    const errors = kind.startsWith("error-")
      ? `compiled ends in: ${lastError(second).name}: ${lastError(second).message}\nbun run ends in:  ${lastError(referenceAgain).name}: ${lastError(referenceAgain).message}\n`
      : "";
    const summary = `compiled: ${second.end}${lastWords && " | " + lastWords}\nbun run:  ${referenceAgain.end}\n${errors}${firstDifference(second.stdout, referenceAgain.stdout)}`;
    let where = "not tried alone";
    let enough: number[] = [];
    if (kind !== "unsteady" && kind !== "bun-run-signal" && !alsoKept.includes(kind) && isolated++ < maxFindsIsolated) {
      const subset = join(work, `subset-${process.pid}`);
      where = (await differsAmong(subset, [texts[index]], extension, 0))
        ? "differs alone too"
        : "DIFFERS ONLY AMONG NEIGHBORS";
      if (where !== "differs alone too") {
        // Halves the neighbors while the difference stays.
        let neighbors = all.filter(other => other !== index);
        const among = (others: number[]) =>
          differsAmong(subset, [texts[index], ...others.map(other => texts[other])], extension, 0);
        const everyNeighbor = neighbors;
        while (neighbors.length > 1) {
          const halves = [neighbors.slice(0, neighbors.length >> 1), neighbors.slice(neighbors.length >> 1)];
          let kept: number[] | undefined;
          for (const half of halves) if (!kept && (await among(half))) kept = half;
          if (!kept) break;
          neighbors = kept;
        }
        where += `: ${neighbors.length} of them are enough, and neighbors.txt holds them`;
        if (neighbors === everyNeighbor && !(await among(neighbors))) {
          where = "differs neither alone nor in a second build with the same neighbors, which neighbors.txt holds";
          counts[kind]--;
          add((kind = "unsteady"));
        }
        enough = neighbors;
      }
      rmSync(subset, { recursive: true, force: true });
    }
    const stoppedBefore = [...(second.stoppedBefore ?? []), ...(referenceAgain.stoppedBefore ?? [])];
    keepFind(kind, summary, {
      ["program" + extension]: texts[index],
      ...(stoppedBefore.length && {
        "stopped-before.txt": stoppedBefore
          .map(other => `// ---- stopped by the runner earlier in the process\n${texts[other]}`)
          .join("\n"),
      }),
      ...(enough.length && {
        "neighbors.txt": enough.map(other => `// ---- neighbor\n${texts[other]}`).join("\n"),
      }),
      ...((kind === "unsteady" || alsoKept.includes(kind)) && {
        "first-compiled.stdout": first.stdout,
        "first-bun-run.stdout": reference.stdout,
      }),
      "report.txt": `${kind}, one of ${texts.length} programs in groups of ${groupSize}\n${bun} build --compile --aot ${buildFlags.join(" ")}\n${summary}without --aot: ${inOrdinary?.end ?? "that build refuses it"}\n${where}\n`,
      "compiled.stdout": second.stdout,
      "compiled.stderr": second.stderr,
      "bun-run.stdout": referenceAgain.stdout,
      "bun-run.stderr": referenceAgain.stderr,
    });
  }
  if (texts.length && Math.random() * 100 < Number(options.collects))
    await judgeUnderCollections(
      folder,
      texts,
      extension,
      groupSize,
      all,
      index => [index],
      false,
      compiled,
      new Set(all.filter(index => !differing.includes(index))),
      milliseconds * 20,
      add,
    );
  if (texts.length && Math.random() * 100 < Number(options["ends-early"]))
    await judgeEndedEarly(folder, texts, extension, groupSize, all, index => [index], compiled, add);
  // The same programs once more, in an executable that checks while it runs what the compiler took for proven. It stops where that is false, also where the output happens to be right.
  if (texts.length && Math.random() * 100 < Number(options.validates)) {
    const flags = [...buildFlags, "--aot-validate"];
    const command = `${bun} build --compile --aot ${flags.join(" ")}`;
    const programsOfTheBuild = texts.map((text, offset) => `// ---- ${offset}\n${text}`).join("\n");
    const { stopped, refused } = await build(folder, texts.length, extension, groupSize, ["--aot", ...flags]);
    if (stopped) {
      add("stopped the validating build");
      keepFind("validating-build-stopped", stopped.reason, {
        ["program" + extension]: stopped.culprit === undefined ? "" : texts[stopped.culprit],
        "programs.txt": programsOfTheBuild,
        "report.txt": `${stopped.reason}\n${command}\nprograms.txt holds the ${texts.length} programs of the build, in groups of ${groupSize}, and the program is number ${stopped.culprit ?? 0} in it\n`,
        "compiler.stderr": stopped.stderr,
        ...(stopped.machine === undefined ? {} : { "machine.txt": stopped.machine }),
      });
    } else if (refused.size === 0) {
      const validated = await run(
        "validating",
        [join(folder, "batch")],
        folder,
        extension,
        groupSize,
        all,
        milliseconds * 4,
      );
      for (const index of all) {
        const ended = validated.get(index)!;
        const said = /^.*\bAOT (?:validation|native call)\b.*$/m.exec(ended.stderr)?.[0];
        // Without such a line, an end by a signal counts where neither of the other two runs ended so.
        const endedBySignalAlone =
          ended.end.startsWith("the process ended") &&
          !wasKilled(ended) &&
          !reservedTooManyAddresses(ended) &&
          // The bound of the run ends the process by SIGTERM, and a program that ran out of time in the other two runs does so here.
          ended.end !== "the process ended: SIGTERM" &&
          ![compiled.get(index)!, plain.get(index)!].some(
            other => other.end.startsWith("the process ended") || isLimit(other),
          );
        if (said === undefined && !endedBySignalAlone) continue;
        add("validation");
        // The numbers of a function and a value differ from build to build.
        const summary = (said ?? ended.end).replace(/\b[a-z]\d+\b/g, "_");
        keepFind("validation", summary, {
          ["program" + extension]: texts[index],
          ...(texts.length > 1 && groupSize > 1 && { "programs.txt": programsOfTheBuild }),
          "report.txt": `validation, one of ${texts.length} programs in groups of ${groupSize}, number ${index}\n${command}\n${said ?? ended.end}\nat default flags: ${compiled.get(index)!.end}, bun run: ${plain.get(index)!.end}\n`,
          "compiled.stdout": ended.stdout,
          "compiled.stderr": ended.stderr,
        });
      }
    }
  }
  mkdirSync(finds, { recursive: true });
  if (batch % 20 === 0)
    writeFileSync(join(finds, `counters-${process.pid}.json`), JSON.stringify(Object.fromEntries(largestSeen)));
  rmSync(folder, { recursive: true, force: true });
  sayWhatTheBatchDid();
}
