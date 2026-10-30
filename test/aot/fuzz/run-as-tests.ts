// Runs generated programs as test files. `bun test --aot` is to be a real test of the compiler: what a program does there is what it
// does under plain `bun test`, or, where compiled code differs from plain Bun on purpose, what its executable does.
//
//   bun test/aot/fuzz/run-as-tests.ts --bun <bun> --out <folder> [--sources a,b:2] [--programs 1000] [--seconds 600] [--seed 1] [--jobs 8]
//   --together <n>   n programs are the test files of one run, which compiles them as one program
//   --flags "--isolate"   more flags for both runs
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
import {
  changeEnvironment,
  outputLimit,
  ProductRunner,
  scriptMarker,
  spawned,
  type Program,
  type Run,
} from "./runners";
import { allSources, multiFileSuffix, rewrittenSuffix } from "./sources";

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
const more = (option("flags") ?? "").split(/\s+/).filter(Boolean);
const work = join(process.env.TMPDIR ?? "/tmp", `aot-fuzz-as-tests-${process.pid}`);

// As in a user's run: the compiler's verifiers are off.
changeEnvironment({}, true);
const runner = new ProductRunner(bun, { baseFlags: [], noVerifiers: true, modes: ["default"] } as never);
const sources = await allSources(join(import.meta.dir, "..", "parallel"), new Set(), true);
const wanted = (
  option("sources")
    ?.split(",")
    .flatMap(word => Array<string>(Number(word.split(":")[1] ?? 1)).fill(word.split(":")[0])) ??
  Object.keys(sources).filter(
    name =>
      !name.endsWith(multiFileSuffix) &&
      !name.endsWith(rewrittenSuffix) &&
      // They run out of stack on purpose, and where the stack ends goes by the frames below: run.ts judges them, each alone.
      !/^(stack-overflow-points|work-during-stack-unwinding)$/.test(name),
  )
).filter(name => sources[name]);
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
  // What a program says when the process ends, a test file says when the whole run ends. What lies in the heap goes by all that the
  // run holds. A file that imports the entry point by its name does not find the test file.
  ![program.text, ...Object.values(program.files ?? {})].some(text =>
    /\bon(ce)?\(\s*["'`](exit|beforeExit)\b|\bbun:jsc\b|\bheapStats\b|\bmemoryUsage\b|["'`]\.\.?\/main\.[cm]?[jt]sx?["'`]/.test(
      text,
    ),
  );

/** As test file number `index`, or, without a number, as what the executable is built from. */
function write(folder: string, name: string, program: Program, index?: number) {
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
function printed(run: Run): string {
  if (!parallel) return run.stdout;
  const lines: string[] = [];
  let rulesLeft = 0;
  for (const line of run.stderr.split("\n")) {
    if (/^ \d+ pass$/.test(line)) break;
    if (line === "# Unhandled error between tests") rulesLeft = 2;
    else if (rulesLeft) rulesLeft -= Number(/^-{20,}$/.test(line));
    else if (line && !/^p\d+(\/main)?\.test\.\w+:$|^\((pass|fail)\) ran to its end\b/.test(line)) lines.push(line);
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
  const judged: Judged = { plain: await spawned([bun, "test", ...more, ...files], folder, 60), failing: new Map(), executables: new Map() }; // prettier-ignore
  const { plain } = judged;
  // A run that plain Bun does not end says nothing.
  if (plain.signal || plain.timedOut) return (tallies && counts.plainFails++, judged);
  const compiled = (judged.compiled = await spawned([bun, "test", "--aot", ...more, ...files], folder, 180));
  if (compiled.signal || compiled.timedOut) {
    judged.kind = compiled.signal ? "crash" : "hang";
    judged.why =
      `${compiled.signal ?? ""} ${/^.*(panic|ASSERTION FAILED|Segmentation fault|AOT: |error: internal).*$/m.exec(compiled.stderr)?.[0] ?? ""}`.trim();
    return judged;
  }
  // What was read of a run ends at a limit, and with --parallel the files end in any order: another file is cut each time.
  if ([plain, compiled].some(run => Buffer.byteLength(parallel ? run.stderr : run.stdout) >= outputLimit))
    return (tallies && counts.tooLong++, judged);
  const [theirs, ours] = [byFile(plain, programs.length), byFile(compiled, programs.length)];
  // A file that waits at its top level: plain Bun goes on to load the next files meanwhile, a compiled run ends it first; what a file
  // prints late stands under the next one. With --parallel what one file wrote to stdout and to stderr comes through two pipes. Where
  // the files print the same lines in another order, nothing is told apart by file, and no value is wrong.
  const sorted = (parts: string[]) => parts.join("\n").split("\n").sort().join("\n");
  if (
    (programs.length > 1 || parallel) &&
    theirs.some((text, index) => text !== ours[index]) &&
    sorted(theirs) === sorted(ours)
  ) {
    if (tallies) counts.otherOrder++;
    return judged;
  }
  if (tallies && theirs.every(text => !text)) counts.silent++;
  for (const [index, program] of programs.entries()) {
    if (theirs[index] === ours[index]) continue;
    if (program.meant?.(theirs[index] + "\n", ours[index] + "\n")) {
      if (tallies) counts.meant++;
      continue;
    }
    const entry = write(join(folder, "executable"), `p${index}`, program);
    const build = await spawned([bun, "build", "--compile", "--aot", entry, "--outfile", join(folder, "x")], dirname(entry), 180); // prettier-ignore
    const run = build.exitCode === 0 ? await spawned([join(folder, "x")], dirname(entry), 60) : undefined;
    judged.executables.set(
      index,
      run ? run.stdout : "the build stops: " + (build.stderr + build.stdout).slice(0, 2000),
    );
    // Where the compiler refuses the program, the test file does not run either.
    const said = run && (parallel ? run.stdout.split("\n").filter(Boolean).join("\n") : withoutLastBreaks(run.stdout));
    if (run ? said === ours[index] : ours[index] === "") {
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
    theirs.every((text, index) => text === ours[index]) &&
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
      const program = sources[wanted[seed % wanted.length]](seed, runner);
      if (program && suits(program)) drawn.push(program);
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
      const [first, second] = [judged.plain, await spawned([bun, "test", ...more, ...files], folder, 60)].map(run => byFile(run, drawn.length)); // prettier-ignore
      for (const index of [...judged.failing.keys()]) if (first[index] !== second[index]) judged.failing.delete(index);
      if (!judged.failing.size) {
        counts.plainWavers++;
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
      `bun test ${more.join(" ")} .\nbun test --aot ${more.join(" ")} .\n# ${how}: ${names}\n# all: ${drawn.map(each => `${each.source}:${each.seed}`).join(",")}\n`,
    );
  }
  rmSync(folder, { recursive: true, force: true });
}

mkdirSync(out, { recursive: true });
await Promise.all(Array.from({ length: jobs }, (_, slot) => round(slot)));
rmSync(work, { recursive: true, force: true });
console.log(
  `TOTAL ${counts.programs} programs in ${counts.runs} runs: ${counts.same} runs the same, ${counts.otherOrder} of them in another order across files, ${counts.asTheExecutable} programs as the executable, ${counts.meant} meant, ${counts.plainFails} runs where plain Bun fails, ${counts.plainWavers} where it wavers, ${counts.silent} where no file prints, ${counts.tooLong} too long to read whole, ${counts.finds} FINDS`,
);
// Nothing compared is nothing judged: what the files print is not where this driver reads it.
if (counts.runs && counts.silent === counts.runs)
  console.log(`FIND as-a-test nothing judged | ${more.join(" ") || "no flags"} | every run | no test file printed a line in ${counts.runs} runs`); // prettier-ignore
