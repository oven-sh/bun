// Runs generated programs as test files. `bun test --aot` is to be a real test of the compiler: what a program does there is what it
// does under plain `bun test`, or, where compiled code differs from plain Bun on purpose, what its executable does.
//
//   bun test/aot/fuzz/run-as-tests.ts --bun <bun> --out <folder> [--sources a,b:2] [--programs 1000] [--seconds 600] [--seed 1] [--jobs 8]
//   --together <n>   n programs are the test files of one run, which compiles them as one program
//   --flags --isolate,--parallel=4   more flags for both runs
//   --layers <n>     the compiled run is built in n layers under its test files, however small it is; a run that was not is a failure
//   --multi-file     each program is split into several files that import each other; the test file is one of them
//   --as-packages    the other files of a program lie in a package under its node_modules, where all of them are JavaScript
//
// Each test file first prints a line with its number, so what a run prints is told apart by file. A program fails if under
// `bun test --aot` it prints otherwise than BOTH the plain run and the executable of `bun build --compile --aot`; the executable is only
// built where the first two differ. A run fails if it ends by a signal or out of time where the plain one does not, or with another
// exit code though every file printed the same. Each failure is a line `FIND as-a-test ..` and a folder under <out>/findings with the
// files and the outputs. A program that fails beside others is tried once more alone: the line says "only together" if it then passes.
// Several files that print the same lines in another order are no failure: they are counted.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import * as builtInsReplacedByTests from "./built-ins-replaced-by-tests";
import { generate as exportsReplacedByTests } from "./exports-replaced-by-tests";
import { generate as modulesLoadedAgainByTests } from "./modules-loaded-again-by-tests";
import { Random } from "./random";
import {
  changeEnvironment,
  outputLimit,
  ProductRunner,
  scriptMarker,
  spawned,
  type Program,
  type Run,
} from "./runners";
import {
  allSources,
  anotherCallSuffix,
  fourCallersSuffix,
  multiFileSuffix,
  neverTakenSuffix,
  ownCopiesSuffix,
  rewrittenSuffix,
} from "./sources";

const option = (name: string) => {
  const at = process.argv.indexOf("--" + name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const bun = option("bun") ?? process.execPath;
const out = option("out") ?? join(process.cwd(), "fuzz-out-as-tests");
const jobs = Number(option("jobs") ?? Math.max(1, availableParallelism() >> 2));
const together = Number(option("together") ?? 1);
const limit = Number(option("programs") ?? Infinity);
const until = Date.now() + Number(option("seconds") ?? 600) * 1000;
const more = (option("flags") ?? "").split(/[\s,]+/).filter(Boolean);
const layers = option("layers");
/**
 * By itself a run is built in layers only where it is large. With the word it also says on stderr how it was built. Every run gets
 * the word, the plain one and the executable too: a program may print its environment.
 */
const words = layers ? { BUN_DEBUG_TEST_AOT_WORDS: `TestRunLayers:${layers}` } : undefined;
const setting = Object.entries(words ?? {}).map(([name, value]) => `${name}=${value} `).join(""); // prettier-ignore
const work = join(process.env.TMPDIR ?? "/tmp", `aot-fuzz-as-tests-${process.pid}`);

// As in a user's run: the compiler's verifiers are off.
changeEnvironment({}, true);
const runner = new ProductRunner(bun, { baseFlags: [], noVerifiers: true, modes: ["default"] } as never);
const sources = await allSources(join(import.meta.dir, "..", "parallel"), new Set(), true);
/** Sources of this driver alone: their programs are test files, and are written to suit it. */
const own: Record<string, (seed: number) => Program> = {
  "built-ins-replaced-by-tests": seed => ({
    ...builtInsReplacedByTests.generate(new Random(seed)),
    extension: "js",
    meant: builtInsReplacedByTests.meant,
  }),
  "exports-replaced-by-tests": seed => ({ ...exportsReplacedByTests(new Random(seed)), extension: "js" }),
  "modules-loaded-again-by-tests": seed => modulesLoadedAgainByTests(new Random(seed)),
};
const wanted = (
  option("sources")
    ?.split(",")
    .flatMap(word => Array<string>(Number(word.split(":")[1] ?? 1)).fill(word.split(":")[0])) ??
  Object.keys(sources).filter(
    name =>
      name.endsWith(multiFileSuffix) === process.argv.includes("--multi-file") &&
      !name.endsWith(rewrittenSuffix) &&
      !name.endsWith(neverTakenSuffix) &&
      !name.endsWith(anotherCallSuffix) &&
      !name.endsWith(ownCopiesSuffix) &&
      !name.endsWith(fourCallersSuffix) &&
      // They run out of stack on purpose, and where the stack ends goes by the frames below: run.ts judges them, each alone.
      !/^(stack-overflow-points|work-during-stack-unwinding)(-|$)/.test(name),
  )
).filter(name => sources[name] || own[name]);
// One program in ten is of the driver's own sources.
if (!option("sources"))
  for (const name of Object.keys(own)) wanted.push(...Array<string>(Math.ceil(wanted.length / 9 / Object.keys(own).length)).fill(name)); // prettier-ignore
if (!wanted.length) throw new Error("no source of programs");

type Drawn = Program & { source: string; seed: number };
const tail = 'import { test as ranToItsEnd } from "bun:test";\nranToItsEnd("ran to its end", () => {});\n';
/** Not a CommonJS file, which takes no import; nothing that asks for flags or an environment of its own. */
const suits = (program: Program) =>
  /^(js|ts|mjs|mts|jsx|tsx)$/.test(program.extension) &&
  !program.text.startsWith(scriptMarker) &&
  !program.flags?.length &&
  !program.plainEnvironment &&
  !program.entryPoints?.length &&
  // A tsconfig.json that lists its files by name does not know the name of the test file.
  !/"(files|include)"/.test(program.files?.["tsconfig.json"] ?? "") &&
  // A file that ends the process ends a whole run that is one process, and its own part of a run that is several.
  // What a program says when the process ends, a test file says when the whole run ends. What lies in the heap goes by all that the
  // run holds. A file that imports the entry point by its name does not find the test file. A run ends with its tests and waits for no
  // timer, no import() and no callback of native code: how much is printed behind one goes by how long the run lives.
  ![program.text, ...Object.values(program.files ?? {})].some(text =>
    /\bon(ce)?\(\s*["'`](exit|beforeExit)\b|\bset(Timeout|Interval|Immediate)\b|\bimport\(|\bprocess\.exit\(|\brandomBytes\(\d+, |\bbun:jsc\b|\bheapStats\b|\bmemoryUsage\b|["'`]\.\.?\/main(\.[cm]?[jt]sx?)?["'`]/.test(
      text,
    ),
  );

const asPackages = process.argv.includes("--as-packages");
/** The files keep their places beside each other, so only the entry point names them otherwise. */
function withItsFilesInAPackage(program: Program): Program {
  const paths = Object.keys(program.files ?? {});
  if (!paths.length || !paths.every(path => /^[\w-]+\.[cm]?js$/.test(path))) return program;
  const files: Record<string, string> = {
    "node_modules/parts/package.json": '{ "name": "parts", "version": "1.0.0" }\n',
  };
  for (const path of paths) files["node_modules/parts/" + path] = program.files![path];
  const named = new RegExp(`(["'])\\./(${paths.map(path => path.replace(".", "\\.")).join("|")})\\1`, "g");
  return { ...program, files, text: program.text.replace(named, "$1parts/$2$1") };
}

/** As test file number `index`, or, without a number, as what the executable is built from. */
function write(folder: string, name: string, given: Program, index?: number) {
  const program = asPackages ? withItsFilesInAPackage(given) : given;
  const home = program.files ? join(folder, name) : folder;
  mkdirSync(home, { recursive: true });
  for (const [path, text] of Object.entries(program.files ?? {})) {
    mkdirSync(dirname(join(home, path)), { recursive: true });
    writeFileSync(join(home, path), text);
  }
  const isTest = index !== undefined;
  const file = join(home, `${program.files ? "main" : name}${isTest ? ".test" : ""}.${program.extension}`);
  // The import makes the test file an ES module, with another `this` at its top than a script has: the executable is built from one too.
  const asModule = /^(import|export)\b/m.test(program.text) ? program.text : program.text + "\nexport {};\n";
  writeFileSync(file, isTest ? `console.log("<<< p${index}");\n${program.text}\n${tail}` : asModule);
  return file;
}

/**
 * What the test files printed. It is the run's stdout; with --parallel a run hands on what a file wrote to stdout and to stderr on its own
 * stderr, file by file, between what it says about itself: the names of the files, the tests, the errors nobody caught, the sums.
 */
const parallel = more.some(flag => flag.startsWith("--parallel"));
/** An error, a warning or a note of the run, a frame, a line of source under an error, what a compiled run says under a test that failed. */
const isDiagnostic = (line: string) =>
  /^AOT test run \| |^(error|warn|note): |^\s+at |^\s*\d+ \| |^\s*\^+\s*$|^\u2717 /.test(line) ||
  /^ +\^ while this file ran, /.test(line);
/** With --parallel a line may come in two pieces, with the name of another file between them. */
const flat = (text: string) => (parallel ? text.replaceAll("\n", "") : text);
function printed(run: Run): string {
  if (!parallel) return run.stdout;
  const lines: string[] = [];
  let rulesLeft = 0;
  const all = run.stderr.split("\n");
  for (const [at, line] of all.entries()) {
    if (/^ \d+ pass$|^\d+ tests? failed:$/.test(line)) break;
    // The report of an error that a test throws, in plain too, stands before or behind what the file prints next. Its first line is the
    // error's text, above the frames.
    if (/^[A-Z]\w*: /.test(line) && /^\s+at /.test(all[at + 1] ?? "")) continue;
    if (line === "# Unhandled error between tests") rulesLeft = 2;
    else if (rulesLeft) rulesLeft -= Number(/^-{20,}$/.test(line));
    // The run names a file each time it goes on with it: what a file prints in its tests may stand behind another file's lines.
    else if (/^p\d+(\/main)?\.test\.\w+:$/.test(line)) lines.push("<<< p" + /\d+/.exec(line)![0]);
    else if (line && !/^\((pass|fail|skip|todo)\) /.test(line) && !isDiagnostic(line)) lines.push(line);
  }
  return lines.join("\n");
}

/** A line that ends in a blank keeps it, wherever it stands. */
const withoutLastBreaks = (text: string) => text.replace(/\n+$/, "");

/** What each test file printed. `bun test` prints its version first. */
function byFile(run: Run, count: number): string[] {
  const parts = Array<string>(count).fill("");
  let at = -1;
  for (const line of printed(run).split("\n")) {
    const mark = /^<<< p(\d+)$/.exec(line);
    if (mark) at = Number(mark[1]);
    else if (at >= 0) parts[at] += line + "\n";
  }
  return parts.map(withoutLastBreaks);
}
const ended = (run: Run) => `exit ${run.exitCode} ${run.signal ?? ""}${run.timedOut ? "out of time" : ""}`;
const whole = (run: Run) => `${run.stdout}\n${ended(run)}\n--- stderr\n${run.stderr}`;
const counts = {
  programs: 0,
  runs: 0,
  same: 0,
  otherOrder: 0,
  asTheExecutable: 0,
  meant: 0,
  plainFails: 0,
  plainWavers: 0,
  silent: 0,
  tooLong: 0,
  onlyOnce: 0,
  finds: 0,
};
let next = Number(option("seed") ?? Math.floor(Date.now() / 1000) * 1000);

interface Judged {
  plain: Run;
  compiled?: Run;
  /** By the number of the file: why it fails. */
  failing: Map<number, string>;
  /** The run itself fails. */
  why?: string;
  kind?: string;
  executables: Map<number, string>;
}

async function judge(folder: string, programs: Drawn[], tallies: boolean): Promise<Judged> {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const files = programs.map((program, index) => write(folder, `p${index}`, program, index));
  const judged: Judged = { plain: await spawned([bun, "test", ...more, ...files], folder, 60, words), failing: new Map(), executables: new Map() }; // prettier-ignore
  const { plain } = judged;
  // A run that plain Bun does not end says nothing.
  if (plain.signal || plain.timedOut) return (tallies && counts.plainFails++, judged);
  const compiled = (judged.compiled = await spawned(
    [bun, "test", "--aot", ...more, ...files],
    folder,
    180 + 15 * files.length,
    words,
  ));
  if (compiled.signal || compiled.timedOut) {
    judged.kind = compiled.signal ? "crash" : "hang";
    judged.why =
      `${compiled.signal ?? ""} ${/^.*(panic|ASSERTION FAILED|Segmentation fault|AOT: |error: internal).*$/m.exec(compiled.stderr)?.[0] ?? ""}`.trim();
    return judged;
  }
  // A run that was to be built in layers and was not says nothing about layers.
  if (layers && !compiled.stderr.includes(`AOT test run | layers ${layers} |`)) {
    judged.kind = "not built in layers";
    judged.why = /^AOT test run \| .*$/m.exec(compiled.stderr)?.[0] ?? "the run does not say how it was built";
    return judged;
  }
  // What was read of a run ends at a limit, and with --parallel the files end in any order: another file is cut each time.
  if ([plain, compiled].some(run => Buffer.byteLength(parallel ? run.stderr : run.stdout) >= outputLimit))
    return (tallies && counts.tooLong++, judged);
  const [theirs, ours] = [byFile(plain, programs.length), byFile(compiled, programs.length)];
  // A file that waits at its top level: plain Bun goes on to load the next files meanwhile, a compiled run ends it first; what a file
  // prints late stands under the next one. With --parallel what one file wrote to stdout and to stderr comes through two pipes. Where
  // the files print the same lines in another order, nothing is told apart by file, and no value is wrong.
  const sorted = (parts: string[]) => parts.join("\n").split("\n").filter(Boolean).sort().join("\n");
  if (
    (programs.length > 1 || parallel) &&
    theirs.some((text, index) => flat(text) !== flat(ours[index])) &&
    sorted(theirs) === sorted(ours)
  ) {
    if (tallies) counts.otherOrder++;
    return judged;
  }
  if (tallies && theirs.every(text => !text)) counts.silent++;
  for (const [index, program] of programs.entries()) {
    if (flat(theirs[index]) === flat(ours[index])) continue;
    if (program.meant?.(theirs[index] + "\n", ours[index] + "\n")) {
      if (tallies) counts.meant++;
      continue;
    }
    const entry = write(join(folder, "executable"), `p${index}`, program);
    const build = await spawned([bun, "build", "--compile", "--aot", entry, "--outfile", join(folder, "x")], dirname(entry), 180); // prettier-ignore
    const run = build.exitCode === 0 ? await spawned([join(folder, "x")], dirname(entry), 60, words) : undefined;
    judged.executables.set(
      index,
      run ? run.stdout : "the build stops: " + (build.stderr + build.stdout).slice(0, 2000),
    );
    // Where the compiler refuses the program, the test file does not run either.
    const said =
      run &&
      (parallel
        ? run.stdout
            .split("\n")
            .filter(line => line && !isDiagnostic(line))
            .join("\n")
        : withoutLastBreaks(run.stdout));
    if (run ? flat(said!) === flat(ours[index]) : ours[index] === "") {
      if (tallies) counts.asTheExecutable++;
      continue;
    }
    const [wanted, got] = [theirs[index].split("\n"), ours[index].split("\n")];
    const at = got.findIndex((line, row) => line !== wanted[row]);
    const row = at < 0 ? got.length : at;
    judged.failing.set(index, `plain ${JSON.stringify((wanted[row] ?? "<end>").slice(0, 90))} compiled ${JSON.stringify((got[row] ?? "<end>").slice(0, 90))}`); // prettier-ignore
  }
  if (judged.failing.size) judged.kind = "different output";
  else if (
    plain.exitCode !== compiled.exitCode &&
    theirs.every((text, index) => flat(text) === flat(ours[index])) &&
    // Compiled frames are smaller: where plain Bun alone runs out of stack, in a place that the program does not guard, nothing is wrong.
    !(compiled.exitCode === 0 && plain.stderr.includes("Maximum call stack size exceeded"))
  ) {
    judged.kind = "different exit code";
    judged.why = `exit codes ${plain.exitCode} ${compiled.exitCode}: ${/^.*(error|Error).*$/m.exec(compiled.stderr)?.[0] ?? ""}`;
  }
  return judged;
}

async function round(slot: number) {
  const folder = join(work, String(slot));
  while (Date.now() < until && counts.programs < limit) {
    const drawn: Drawn[] = [];
    while (drawn.length < together) {
      const seed = next++;
      const name = wanted[seed % wanted.length];
      if (own[name]) drawn.push({ ...own[name](seed), source: name, seed });
      else {
        const program = sources[name](seed, runner);
        if (program && suits(program)) drawn.push(program);
      }
    }
    counts.programs += drawn.length;
    counts.runs++;
    const judged = await judge(folder, drawn, true);
    if (!judged.kind) {
      if (judged.compiled) counts.same++;
      continue;
    }
    // A program that plain Bun runs otherwise the second time (a worker ended midway, a race) shows nothing.
    if (judged.failing.size) {
      const files = drawn.map((program, index) => write(folder, `p${index}`, program, index));
      const [first, second] = [judged.plain, await spawned([bun, "test", ...more, ...files], folder, 60, words)].map(run => byFile(run, drawn.length)); // prettier-ignore
      for (const index of [...judged.failing.keys()]) if (first[index] !== second[index]) judged.failing.delete(index);
      if (!judged.failing.size) {
        counts.plainWavers++;
        continue;
      }
    }
    // With --parallel the processes race: a failure counts where both runs, made again, fail the same way.
    if (parallel && judged.kind !== "crash") {
      const again = await judge(folder, drawn, false);
      for (const index of [...judged.failing.keys()]) if (!again.failing.has(index)) judged.failing.delete(index);
      if (again.kind !== judged.kind || (judged.kind === "different output" && !judged.failing.size)) {
        counts.onlyOnce++;
        continue;
      }
    }
    counts.finds++;
    const guilty = judged.failing.size ? [...judged.failing.keys()] : drawn.map((_, index) => index);
    let how = "alone";
    if (together > 1) {
      // Does one of them fail by itself?
      const alone: number[] = [];
      for (const index of guilty) if ((await judge(folder, [drawn[index]], false)).kind) alone.push(index);
      how = alone.length ? `together ${together}, and p${alone.join(" p")} alone` : `only together ${together}`;
    }
    const names = guilty.map(index => `${drawn[index].source}:${drawn[index].seed}`).join(",");
    const why = judged.why ?? [...judged.failing.values()][0];
    console.log(`FIND as-a-test ${judged.kind} | ${how} | ${names.slice(0, 200)} | ${why.slice(0, 220)}`);
    const kept = join(out, "findings", `${judged.kind.replaceAll(" ", "-")}-${drawn[guilty[0]].source}-${drawn[guilty[0]].seed}`); // prettier-ignore
    mkdirSync(kept, { recursive: true });
    drawn.forEach((program, index) => write(kept, `p${index}`, program, index));
    writeFileSync(join(kept, "plain.txt"), whole(judged.plain));
    writeFileSync(join(kept, "compiled.txt"), whole(judged.compiled!));
    for (const [index, text] of judged.executables) writeFileSync(join(kept, `executable-p${index}.txt`), text);
    writeFileSync(
      join(kept, "commands.txt"),
      `${setting}bun test ${more.join(" ")} .\n${setting}bun test --aot ${more.join(" ")} .\n# ${how}: ${names}\n# all: ${drawn.map(each => `${each.source}:${each.seed}`).join(",")}\n`,
    );
  }
  rmSync(folder, { recursive: true, force: true });
}

mkdirSync(out, { recursive: true });
await Promise.all(Array.from({ length: jobs }, (_, slot) => round(slot)));
rmSync(work, { recursive: true, force: true });
console.log(
  `TOTAL ${counts.programs} programs in ${counts.runs} runs: ${counts.same} runs the same, ${counts.otherOrder} of them in another order across files, ${counts.asTheExecutable} programs as the executable, ${counts.meant} meant, ${counts.plainFails} runs where plain Bun fails, ${counts.plainWavers} where it wavers, ${counts.silent} where no file prints, ${counts.tooLong} too long to read whole, ${counts.onlyOnce} that fail only once, ${counts.finds} FINDS`,
);
// Nothing compared is nothing judged: what the files print is not where this driver reads it.
if (counts.runs && counts.silent === counts.runs)
  console.log(`FIND as-a-test nothing judged | ${more.join(" ") || "no flags"} | every run | no test file printed a line in ${counts.runs} runs`); // prettier-ignore
