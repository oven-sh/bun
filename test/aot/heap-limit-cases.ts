import { afterAll, describe as describeAnywhere, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isASAN, isLinux, isWindows, tempDir } from "harness";
import { linkSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "./harness/compiler";
import { endAtMemoryLimit, memoryLimitOfAKnownProgram } from "./harness/memory-limit";
import { run as runCommand } from "./harness/run";
import { inTurn } from "./harness/shared-builds";

const describe = unsupported ? describeAnywhere.skip : describeAnywhere.concurrent;

// An ahead-of-time compiled program keeps most references between objects in 32 bits, so its objects live in one reserved range of
// address space. Each Worker has a range of its own. These tests shrink the ranges to see what happens at their end.

const smallHeap = { BUN_JSC_markedBlockCageSizeInMB: "64" };
const limitOf64MB =
  "Each thread of a compiled executable can use 64 MB for JavaScript objects. Build with --aot-huge-heap to remove the limit. The executable then uses more memory and runs slower.";

const keepsEverything = `type Entry = { id: number; next: Entry | null };
let head: Entry | null = null;
for (let i = 0; i < 4_000_000; i++) head = { id: i, next: head };
let entries = 0;
for (let entry: Entry | null = head; entry; entry = entry.next) entries++;
console.log("never full", head!.id, entries);
`;

const keepsObjects = (count: number) => `type Entry = { id: number };
const parts: Entry[][] = [];
for (let first = 0; first < ${count}; first += 100_000) {
  const part: Entry[] = [];
  for (let i = 0; i < 100_000; i++) part.push({ id: first + i });
  parts.push(part);
}
console.log("kept", parts.reduce((sum, part) => sum + part.length, 0));
`;

// No error is thrown at an allocation in a function that has a try of its own: a loop there that calls nothing goes on until nothing is left.
const insideTry = (program: string) => `try {\n${program}} finally {\n  console.log("finally");\n}\n`;

// It catches every error and keeps what it has.
const isToldAndGoesOnFilling = (say: string) => `type Entry = { id: number; next: Entry | null };
let head: Entry | null = null;
for (;;) {
  try {
    for (let i = 0; ; i++) head = { id: i, next: head };
  } catch (error) {
    let entries = 0;
    for (let entry: Entry | null = head; entry; entry = entry.next) entries++;
    ${say}("told " + (error as Error).name + " " + (entries > 100_000));
  }
}
`;

// A function that calls itself tests the stack at its entry, and there a full range ends in an error.
const treeBuilder = `type Tree = { left: Tree | null; right: Tree | null; id: number };
function build(depth: number, id: number): Tree | null {
  if (depth === 0) return null;
  return { left: build(depth - 1, id * 2), right: build(depth - 1, id * 2 + 1), id };
}
function size(tree: Tree | null): number {
  return tree ? 1 + size(tree.left) + size(tree.right) : 0;
}
// Every tree is read: what nobody reads the compiler need not make, and then the list alone grows, eight bytes a push, to millions of entries.
function smallest(trees: (Tree | null)[]): number {
  let least = trees.length < 100_000 ? Infinity : -1;
  for (let i = 0; i < trees.length; i++) least = Math.min(least, size(trees[i]));
  return least;
}
`;

const catchesThreeTimes = `${treeBuilder}let keep: (Tree | null)[] = [];
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    for (;;) keep.push(build(10, 1));
  } catch (error) {
    const last = smallest(keep);
    keep = [];
    console.log(attempt, error instanceof RangeError, (error as Error).message, last);
  }
}
console.log("afterward", size(build(12, 1)));
`;

const callsValuesNobodyKnows = `const makers = {};
for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
  makers[name + name.length] = function (keep, id) {
    keep.push({ id, name, next: keep.length ? keep[keep.length - 1] : null });
    return keep.length;
  };
}
const names = Object.keys(makers);
let keep = [];
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    for (let i = 0; ; i++) makers[names[i & 7]](keep, i);
  } catch (error) {
    const kept = keep.length;
    keep = [];
    console.log(attempt, error instanceof RangeError, error.message, kept > 1000);
  }
}
console.log("afterward", makers[names[0]](keep, 1));
`;

const keepsLittle = `type Entry = { id: number; next: Entry | null };
const ring: (Entry | null)[] = new Array(1024).fill(null);
for (let i = 0; i < 16_000_000; i++) ring[i & 1023] = { id: i, next: null };
console.log("done", ring[1023]!.id);
`;

const twoWorkersThatKeepMoreThanHalfARange = {
  "program.ts": `import { Worker } from "node:worker_threads";
type Entry = { id: number; next: Entry | null };
const seed: Entry = { id: 1_000_000_000, next: { id: 2_000_000_000, next: null } };
const workers = [new Worker("./worker.ts", { workerData: seed }), new Worker("./worker.ts", { workerData: seed })];
let full = 0;
const sums: number[] = [];
for (const worker of workers) {
  worker.on("message", (said: "full" | number) => {
    if (said === "full") {
      if (++full === workers.length) for (const each of workers) each.postMessage("sum");
    } else if (sums.push(said) === workers.length) console.log(sums.join(), seed.next!.id);
  });
}
`,
  "worker.ts": `import { parentPort, workerData } from "node:worker_threads";
type Entry = { id: number; next: Entry | null };
let head: Entry | null = workerData as Entry;
for (let i = 0; i < 2_300_000; i++) head = { id: 1, next: head };
parentPort!.once("message", () => {
  let sum = 0;
  for (let entry: Entry | null = head; entry; entry = entry.next) sum += entry.id;
  parentPort!.postMessage(sum);
});
parentPort!.postMessage("full");
`,
};

const sixWorkersOneAfterTheOther = {
  "program.ts": `import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
const addressSpaceInKB = () => Number(/^VmSize:\\s*(\\d+)/m.exec(readFileSync("/proc/self/status", "utf8"))![1]);
const oneRangeInKB = 32 * 1024 * 1024;
const before = addressSpaceInKB();
for (let i = 0; i < 6; i++) {
  const worker = new Worker("./worker.ts");
  await new Promise(resolve => worker.on("exit", resolve));
}
let grown = addressSpaceInKB() - before;
for (let tries = 0; tries < 100 && grown >= 2 * oneRangeInKB; tries++) {
  await Bun.sleep(50);
  grown = addressSpaceInKB() - before;
}
console.log(grown < 2 * oneRangeInKB ? "given back" : "kept " + grown + " KB");
`,
  "worker.ts": `import { parentPort } from "node:worker_threads";
parentPort!.postMessage("done");
`,
};

// Where the kernel hands a core to a program it starts that program whatever the limit is, but for a limit of one byte.
const withoutCoreDump = (cmd: string[]) =>
  isWindows
    ? cmd
    : [
        "/bin/sh",
        "-c",
        `command -v prlimit > /dev/null 2>&1 && exec prlimit --core=1:1 "$@"; ulimit -c 0 && exec "$@"`,
        "--",
        ...cmd,
      ];

// No more commands at once than the machine has cores: many fill the address space that they are given.
async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await inTurn(() =>
    runCommand(cmd, cwd, { ...bunEnv, BUN_CRASH_REPORT_URL: "", ...env }),
  );
  // The message of the error goes on with the limit and the option that lifts it. A test that reads stderr reads all of it; what a program prints of a message is compared without.
  return { stdout: stdout.replaceAll(": " + limitOf64MB, ""), stderr, exitCode };
}

// A process that ends with an error that nobody caught says the error, the frames of its stack and the version of Bun. The
// frames go by how far the program had come, and the version by the build.
const withoutFramesAndVersion = (stderr: string) =>
  stderr.replace(/^ +at .+\n/gm, "").replace(/\nBun v\S+ \(.+\)\n$/, "");
const outOfMemory = "RangeError: Out of memory: " + limitOf64MB + "\n";

/** `ulimit -v`, in kB. `before` is what else the shell does first. */
const withAddressSpaceOf =
  (kilobytes: number, before = "") =>
  (executable: string) => ["sh", "-c", `${before}ulimit -v ${kilobytes} && exec "$0"`, executable];

/**
 * The executables of one run of the file. `bun test --rerun-each` runs the file again in the same process: it evaluates the test
 * file again and this module once, so a run keeps nothing in a variable of the module.
 */
function executables() {
  const folders: Disposable[] = [];
  const buildsUnderWay = new Set<{ kill(signal: "SIGKILL"): void }>();

  /**
   * `bun build --compile --aot <flags and entry points> --outfile <outfile>` in `cwd`. Answers what to start.
   * A command has one turn, and there are as many turns as cores. So a build is told how many threads it has.
   */
  async function build(cwd: string, outfile: string, threads: number, ...flagsAndEntryPoints: string[]) {
    const cmd = [bunExe(), "build", "--compile", "--aot", `--aot-threads=${threads}`, ...flagsAndEntryPoints];
    const env = { ...bunEnv, BUN_CRASH_REPORT_URL: "" };
    const { stderr, exitCode } = await inTurn(async () => {
      await using proc = Bun.spawn({ cmd: [...cmd, "--outfile", outfile], cwd, env, stdout: "ignore", stderr: "pipe" });
      using held = endAtMemoryLimit(proc, memoryLimitOfAKnownProgram);
      buildsUnderWay.add(proc);
      try {
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        if (held.exceeded) throw new Error(`KILLED at its memory limit: ${cmd.join(" ")}\n${held.held}`);
        return { stderr, exitCode };
      } finally {
        buildsUnderWay.delete(proc);
      }
    });
    expect({ stderr, exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
    return join(cwd, outfile);
  }

  // A build of its own costs a small program about three times what it costs as one of many, and writes an executable the size
  // of Bun. So most programs that start no Worker are the entry points of one executable. --aot-separate-programs compiles each
  // as it is when it is built alone, and BUN_AOT_START_AT names the one that a process starts with. The others take none of its
  // room for objects or for their shapes. They take address space: the process maps the whole executable.
  const programs: Record<string, string> = {};
  const programsByThemselves = new Set<string>();
  /** Adds a program to that executable and answers its name, which `start` takes. `isStarted`: whether a test starts it with the Bun under test. */
  function oneOfMany(name: string, text: string, isStarted = true) {
    if (name in programs && programs[name] !== text) throw new Error(`two programs are named ${name}`);
    if (isStarted) programs[name] = text;
    return name;
  }
  /** The same, for a program that has an executable of its own. Each place that asks for one says why. */
  function byItself(name: string, text: string, isStarted = true) {
    if (isStarted) programsByThemselves.add(name);
    return oneOfMany(name, text, isStarted);
  }

  type Built = { executable: string; cwd: string };
  const builtByThemselves = new Map<string, Promise<Built>>();
  function buildByItself(name: string) {
    return builtByThemselves.getOrInsertComputed(name, async () => {
      const folder = tempDir("aot-heap-limit", { [name]: programs[name] });
      folders.push(folder);
      return { executable: await build(String(folder), "program", 1, name), cwd: String(folder) };
    });
  }

  let builtOfMany: Promise<Built | undefined> | undefined;
  /**
   * Only a canary build of Bun reads BUN_AOT_START_AT. A Bun that does not read it starts an executable at its first entry
   * point, which says so here. The answer is nothing then, and `start` builds each program by itself.
   */
  function buildOfMany() {
    return (builtOfMany ??= (async () => {
      const names = Object.keys(programs).filter(name => !programsByThemselves.has(name));
      const first = "first.ts";
      const folder = tempDir("aot-heap-limit", {
        [first]: `console.log("started at the first entry point");\n`,
        ...Object.fromEntries(names.map(name => [name, programs[name]])),
      });
      folders.push(folder);
      const cwd = String(folder);
      const entryPoints = [first, ...names].map(name => "./" + name);
      const executable = await build(cwd, "programs", 1, "--aot-separate-programs", "--root=.", ...entryPoints);
      const { stdout, stderr, exitCode } = await run([executable], cwd, { BUN_AOT_START_AT: "no-such-program.ts" });
      if (stdout === "started at the first entry point\n" && exitCode === 0) return undefined;
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: "",
        stderr: expect.stringContaining("BUN_AOT_START_AT names no entry point of the executable"),
        exitCode: 1,
      });
      return { executable, cwd };
    })());
  }

  /** Runs a program in a process of its own. `command` is what starts the executable. */
  async function start(name: string, env: Record<string, string> = {}, command = (executable: string) => [executable]) {
    if (!(name in programs)) throw new Error(`no test starts ${name} with this Bun, so it was not built`);
    const ofMany = programsByThemselves.has(name) ? undefined : await buildOfMany();
    const { executable, cwd } = ofMany ?? (await buildByItself(name));
    return run(command(executable), cwd, ofMany ? { ...env, BUN_AOT_START_AT: name } : env);
  }

  // node:worker_threads brings the streams of Node.js along, which makes a build thirty times dearer. The programs that import it are files of one program: its entry points import the files of
  // the case that the working directory names.
  const programsTogether: Record<string, Record<string, string>> = {};
  function together(name: string, files: Record<string, string>) {
    programsTogether[name] = files;
    return { "case.txt": name };
  }
  const importsTheCase = (file: string) =>
    `const files: Record<string, () => Promise<unknown>> = {\n` +
    Object.entries(programsTogether)
      .filter(([, files]) => file in files)
      .map(([name]) => `  "${name}": () => import("./${name}/${file}"),\n`)
      .join("") +
    `};\nawait files[await Bun.file("case.txt").text()]!();\n`;
  let builtTogether: Promise<string> | undefined;
  function buildTogether() {
    return (builtTogether ??= (async () => {
      const files: Record<string, string> = {};
      const alone: string[] = [];
      for (const [name, ofCase] of Object.entries(programsTogether))
        for (const [file, text] of Object.entries(ofCase)) {
          const isShared = file === "program.ts" || file === "worker.ts";
          files[isShared ? `${name}/${file}` : file] = text;
          if (!isShared) alone.push(file);
        }
      files["program.ts"] = importsTheCase("program.ts");
      files["worker.ts"] = importsTheCase("worker.ts");
      const folder = tempDir("aot-heap-limit-together", files);
      folders.push(folder);
      // On a machine with cores to spare this build is what the file waits for longest, so it has a second thread.
      return build(String(folder), "program", 2, "program.ts", "worker.ts", ...alone);
    })());
  }
  /** Puts the executable of all those programs into `cwd` as ./program. */
  async function linkTogether(cwd: string) {
    const executable = await buildTogether();
    const extension = isWindows ? ".exe" : "";
    linkSync(executable + extension, join(cwd, "program" + extension));
    return join(cwd, "program");
  }

  // A build may still be under way at the end: a filter left out the tests that wait for it, or it hangs. It is ended, and
  // then its folder goes.
  afterAll(async () => {
    for (const build of buildsUnderWay) build.kill("SIGKILL");
    await Promise.allSettled([builtOfMany, builtTogether, ...builtByThemselves.values()]);
    folders.forEach(folder => folder[Symbol.dispose]());
  });

  return { oneOfMany, byItself, start, together, buildTogether, linkTogether };
}

// TODO: with AddressSanitizer these run out of room where a release build does not.
const runsOutOfRoomEarly = isASAN;
// `ulimit -v` limits the address space of a process on Linux. A Bun with AddressSanitizer does not start under such a limit.
const canLimitAddressSpace = isLinux && !isASAN;
/** The file of the program of a row of a table. */
const fileNamed = (row: string, extension: string) => row.replace(/[^A-Za-z0-9]+/g, "-") + extension;

/** Every `parts`-th case from the `part`-th. */
export function addressSpaceForObjects(part: number, parts: number) {
  let cases = 0;
  const isInPart = () => cases++ % parts === part - 1;
  const dealt = <Row>(rows: Row[]) => rows.filter(isInPart);
  const { oneOfMany, byItself, start, together, buildTogether, linkTogether } = executables();
  // Tests start in the order in which they are defined, and few run at a time: five with AddressSanitizer. So the order decides
  // when the file ends. The tests that run longest are defined first: the short ones run beside them. The tests of Workers are
  // defined last: their executable takes many times as long to build as the others, and a test that waits for its build keeps
  // the next from starting. The first test starts that build behind its own, so that it is through when the last tests start.
  const testsThatRunLongest: (() => void)[] = [];
  const testsBetween: (() => void)[] = [];
  const testsOfWorkers: (() => void)[] = [];
  const among =
    (tests: (() => void)[]) => (define: typeof test) => (name: string, body: () => Promise<void>, timeout?: number) => {
      if (isInPart()) tests.push(() => define(name, body, timeout));
    };
  const [inPart, inPartWithWorkers] = [among(testsBetween), among(testsOfWorkers)];
  const inPartFirst = (define: typeof test) => (name: string, body: () => Promise<void>, timeout?: number) =>
    among(testsThatRunLongest)(define)(
      name,
      () => {
        const ended = body();
        // Whether a filter (-t) leaves out the tests of Workers is not known here. Then nothing waits for this build, and it is
        // ended with the file. Otherwise a test of a Worker says how it failed.
        if (testsOfWorkers.length) buildTogether().catch(() => {});
        return ended;
      },
      timeout,
    );
  /** `define.each(rows)` among the tests of `inPart`. The rows are dealt already. */
  const eachOf =
    (define: typeof test, rows: string[][]) =>
    (name: string, body: (...row: string[]) => Promise<void>, timeout?: number) =>
      void testsBetween.push(() => define.each(rows)(name, body, timeout));

  describe("the address space for objects of a compiled program", () => {
    const keepsEverythingProgram = oneOfMany("keeps-everything.ts", keepsEverything);
    inPart(test)(
      "a program that keeps more objects alive than fit ends with a RangeError",
      async () => {
        const { stdout, stderr, exitCode } = await start(keepsEverythingProgram, smallHeap);
        expect({ stdout, stderr: withoutFramesAndVersion(stderr), exitCode }).toEqual({
          stdout: "",
          stderr: outOfMemory,
          exitCode: 1,
        });
      },
      120_000,
    );

    const keepsEverythingInATry = oneOfMany("keeps-everything-in-a-try.ts", insideTry(keepsEverything));
    inPart(test)(
      "inside a try it ends with the same error, and the finally runs",
      async () => {
        const { stdout, stderr, exitCode } = await start(keepsEverythingInATry, smallHeap);
        expect({ stdout, stderr: withoutFramesAndVersion(stderr), exitCode }).toEqual({
          stdout: "finally\n",
          stderr: outOfMemory,
          exitCode: 1,
        });
      },
      120_000,
    );

    const isToldAndFillsOn = oneOfMany(
      "is-told-and-fills-on.ts",
      isToldAndGoesOnFilling("console.log"),
      !runsOutOfRoomEarly,
    );
    inPart(test.skipIf(runsOutOfRoomEarly))(
      "a program that is told and goes on filling stops and says why",
      async () => {
        const { stdout, stderr, exitCode } = await start(isToldAndFillsOn, smallHeap, executable =>
          withoutCoreDump([executable]),
        );
        expect(stderr).toContain("FATAL: out of memory. " + limitOf64MB);
        expect(stderr).toMatch(/Bun (has run|ran) out of memory/);
        expect(stderr).not.toContain("This indicates a bug in Bun");
        expect(stdout).toMatch(/^(told RangeError true\n)+$/);
        expect(exitCode).not.toBe(0);
      },
      120_000,
    );

    // The function that fills the range has the handler. Nothing in its loop but the built-in makes anything, and a loop that ends with its list makes records.
    const made: Record<string, string> = {
      listsOfFractions: "[i + 0.5, i + 1.5, i + 2.5, i + 3.5]",
      records: "{ a: i, b: i, c: i, d: i }",
      keys: "Object.keys(source)",
      padded: 'String(i).padStart(40, "-")',
      matches: '/a(b)c/.exec("abc")',
      dates: "new Date(i)",
      symbols: 'Symbol("s")',
      fixed: "(i / 3).toFixed(8)",
      boxed: "new Number(i)",
      bound: "fill_keys.bind(null)",
      promises: "Promise.resolve(i)",
      sets: "new Set(list)",
      slices: "list.slice(1)",
      bytes: "new Uint8Array(8)",
      whatACallMakes: "make(i)",
    };
    // It runs many times as long as most. By itself it is built first, and it runs while the others are still being built.
    const fillsInATry = byItself(
      "fills-in-a-try.ts",
      `const source: Record<string, number> = {};
for (let i = 0; i < 24; i++) source["name" + i] = 1;
const list = [1, 2, 3, 4, 5, 6, 7, 8];
const many: number[] = [];
for (let i = 0; i < 4_000_000; i++) many.push(i);
let caught = 0;
// Too large to become a part of its caller. It has no loop, no handler, and nothing in it throws by the rules of the language.
function make(n: number) {
  return { ${["a", "b", "c"].map(part => `${part}: { ${Array.from({ length: 40 }, (_, index) => `${part}${index}: n + ${index}`).join(", ")} }`).join(", ")} };
}
${Object.entries(made)
  .map(
    ([name, expression]) => `function fill_${name}(): boolean {
  const keep: unknown[] = [];
  try {
    for (let i = 0; ; i++) keep.push(${expression});
  } catch (error) {
    caught++;
    return error instanceof RangeError && keep.length > 1000;
  }
}
`,
  )
  .join("")}function fill_aRecordForEachOfAList(): boolean {
  const keep: unknown[] = [];
  try {
    for (let i = 0; i < many.length; i++) keep.push({ a: many[i], b: i, c: i + 1, d: i + 2 });
  } catch (error) {
    caught++;
    return error instanceof RangeError && keep.length > 1000;
  }
  return false;
}
for (const fill of [${Object.keys(made)
        .map(name => "fill_" + name)
        .join(", ")}, fill_aRecordForEachOfAList]) {
  caught = 0;
  let escaped = 0;
  let answer = false;
  try {
    answer = fill();
  } catch {
    escaped++;
  }
  console.log(fill.name, answer, caught, escaped);
}
`,
    );
    inPartFirst(test)(
      "a loop inside a try that fills the range gets the RangeError in its own catch, whatever it fills the range with",
      async () => {
        const { stdout, stderr, exitCode } = await start(fillsInATry, smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: [...Object.keys(made), "aRecordForEachOfAList"].map(name => `fill_${name} true 1 0\n`).join(""),
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    // Where functions are entered, the error comes at the next entry that tests the stack, in a try or not.
    const catchesThreeTimesProgram = oneOfMany("catches-three-times.ts", catchesThreeTimes);
    inPart(test)(
      "a program that fills the range in functions that call themselves catches a RangeError and goes on",
      async () => {
        const { stdout, stderr, exitCode } = await start(catchesThreeTimesProgram, smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: "0 true Out of memory 1023\n1 true Out of memory 1023\n2 true Out of memory 1023\nafterward 4095\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    const callsValuesNobodyKnowsProgram = oneOfMany("calls-values-nobody-knows.js", callsValuesNobodyKnows);
    inPart(test)(
      "so does one that calls values nobody knows",
      async () => {
        const { stdout, stderr, exitCode } = await start(callsValuesNobodyKnowsProgram, smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: "0 true Out of memory true\n1 true Out of memory true\n2 true Out of memory true\nafterward 1\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    const nobodyCatches = oneOfMany(
      "nobody-catches.ts",
      `${treeBuilder}const keep: (Tree | null)[] = [];
process.on("exit", (code: number) => console.log("exit", code, smallest(keep)));
for (;;) keep.push(build(10, 1));
`,
    );
    inPart(test)(
      "an error that nobody catches ends the process as any other does",
      async () => {
        const { stdout, stderr, exitCode } = await start(nobodyCatches, smallHeap);
        expect({ stdout, stderr: withoutFramesAndVersion(stderr), exitCode }).toEqual({
          stdout: "exit 1 1023\n",
          stderr: outOfMemory,
          exitCode: 1,
        });
      },
      120_000,
    );

    // A loop that calls nothing enters no function. Its allocations go to the run time for each new block of memory, and there the error is thrown, as long as the function of the loop has no try of its own.
    const loopsThatCallNothing = oneOfMany(
      "loops-that-call-nothing.ts",
      `type Pair = { a: number; b: number };
const source: number[] = new Array(3_000_000).fill(1);
const wide: Record<string, number> = {};
for (let i = 0; i < 300_000; i++) wide["k" + i] = i;
const short: number[][] = Array.from({ length: 300_000 }, (_, i) => [i]);
const fills: [string, () => unknown[]][] = [
  ["a loop without a bound", () => { const out: Pair[] = []; for (let i = 0; ; i++) out.push({ a: i, b: i }); }],
  ["a loop up to the length of an array", () => { const out: Pair[] = []; for (let i = 0; i < source.length; i++) out.push({ a: source[i], b: i }); return out; }],
  ["map", () => source.map((value, i) => ({ a: value, b: i }))],
  ["Array.from", () => Array.from({ length: 3_000_000 }, (_, i) => ({ a: i, b: i }))],
  ["Object.entries", () => { const all: unknown[] = []; for (let i = 0; i < 8; i++) all.push(Object.entries(wide)); return all; }],
  ["a spread a turn", () => { const all: number[][] = []; for (let i = 0; i < short.length; i++) all.push([...short[i], i, i, i, i, i, i, i, i, i, i, i, i]); return all; }],
  ["closures", () => { const all: (() => number)[] = []; for (let i = 0; i < 3_000_000; i++) all.push(() => i); return all; }],
  ["texts", () => { const all: string[] = []; for (let i = 0; i < 6_000_000; i++) all.push("n" + i); return all; }],
];
for (const [what, fill] of fills) {
  try {
    console.log(what, "finished", fill().length);
  } catch (error) {
    console.log(what, (error as Error).name, (error as Error).message);
  }
}
console.log("afterward", short.slice(0, 1000).map(part => ({ part })).length);
`,
    );
    inPart(test)(
      "loops that allocate and call nothing get the RangeError where they allocate",
      async () => {
        const { stdout, stderr, exitCode } = await start(loopsThatCallNothing, smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout:
            [
              "a loop without a bound",
              "a loop up to the length of an array",
              "map",
              "Array.from",
              "Object.entries",
              "a spread a turn",
              "closures",
              "texts",
            ]
              .map(what => what + " RangeError Out of memory\n")
              .join("") + "afterward 1000\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    const callersWithFinallyAndUsing = oneOfMany(
      "callers-with-finally-and-using.ts",
      `type Pair = { a: number; b: number };
let kept: Pair[] = [];
function fill() {
  for (let i = 0; ; i++) kept.push({ a: i, b: i });
}
function withFinally() {
  try {
    fill();
  } finally {
    const length = kept.length;
    kept = [];
    console.log("finally", length > 100_000);
  }
}
function withUsing() {
  using resource = { [Symbol.dispose]() { const length = kept.length; kept = []; console.log("disposed", length > 100_000); } };
  fill();
}
async function later() {
  await null;
  fill();
}
for (const run of [withFinally, withUsing]) {
  try {
    run();
  } catch (error) {
    console.log(run.name, (error as Error).name, (error as Error).message);
  }
}
await later().catch(error => { kept = []; console.log("rejected", error.name, error.message); });
console.log("afterward", kept.length);
`,
    );
    inPart(test)(
      "what the callers of such a loop have in finally and in using runs",
      async () => {
        const { stdout, stderr, exitCode } = await start(callersWithFinallyAndUsing, smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout:
            "finally true\nwithFinally RangeError Out of memory\ndisposed true\nwithUsing RangeError Out of memory\nrejected RangeError Out of memory\nafterward 0\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    // Native code that makes an object for each piece of its input enters no function of the program: it asks by itself, once an object, whether the error is owed.
    // The list that is copied takes about half of the room. With its six copies it is larger than the whole range.
    const parsesAndCopies = oneOfMany(
      "parses-and-copies.ts",
      `const text = "[" + '{"a":1,"b":"x"},'.repeat(2_000_000) + '{"a":1}]';
function attempt(what: string, fill: () => unknown[]) {
  try {
    console.log(what, "finished", fill().length);
  } catch (error) {
    console.log(what, (error as Error).name, (error as Error).message);
  }
}
attempt("a text", () => JSON.parse(text));
attempt("a text and a reviver", () => JSON.parse(text, (key, value) => value));
const part: unknown[] = JSON.parse("[" + '{"a":1,"b":2},'.repeat(200_000) + "0]");
attempt("copies", () => {
  const all: unknown[] = [];
  for (let i = 0; i < 6; i++) all.push(structuredClone(part));
  return all;
});
attempt("a small text afterward", () => JSON.parse("[1,2,3]"));
attempt("a small copy afterward", () => structuredClone([1, { a: 2 }]));
`,
      !runsOutOfRoomEarly,
    );
    inPart(test.skipIf(runsOutOfRoomEarly))(
      "one text or one message with more objects than fit is a RangeError of JSON.parse and of structuredClone",
      async () => {
        const { stdout, stderr, exitCode } = await start(parsesAndCopies, smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout:
            "a text RangeError Out of memory\na text and a reviver RangeError Out of memory\ncopies RangeError Out of memory\na small text afterward finished 3\na small copy afterward finished 2\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    const case1 = together("1", {
      "program.ts": `import { Worker } from "node:worker_threads";
const worker = new Worker("./worker.ts");
worker.on("message", (said: string) => console.log("the Worker says:", said));
worker.on("error", (error: Error) => console.log("the Worker ends with:", error.name, error.message));
worker.on("exit", (code: number) => console.log("exit", code, "and the main thread goes on:", JSON.parse("[" + "{},".repeat(100_000) + "0]").length));
worker.postMessage("[1,2]");
worker.postMessage("[" + '{"a":1,"b":"x"},'.repeat(2_000_000) + '{"a":1}]');
`,
      "worker.ts": `import { parentPort } from "node:worker_threads";
parentPort!.on("message", (text: string) => parentPort!.postMessage("parsed " + JSON.parse(text).length));
`,
    });
    inPartWithWorkers(test)(
      "a Worker that is sent such a text ends alone",
      async () => {
        using folder = tempDir("aot-heap-limit", case1);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout:
            "the Worker says: parsed 2\nthe Worker ends with: RangeError Out of memory\nexit 1 and the main thread goes on: 100001\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    const case2 = together("2", {
      "program.ts": `import { Worker } from "node:worker_threads";
const worker = new Worker("./worker.ts");
worker.on("message", (said: string) => console.log("the Worker says:", said));
worker.on("error", (error: Error) => console.log("the Worker ends with:", error.name, error.message));
worker.on("exit", (code: number) => {
  const list: { id: number }[] = [];
  for (let i = 0; i < 100_000; i++) list.push({ id: i });
  console.log("exit", code, "and the main thread goes on:", list.length);
});
`,
      "worker.ts": `import { parentPort } from "node:worker_threads";
${treeBuilder}let keep: (Tree | null)[] = [];
process.on("exit", () => console.log("the Worker held trees of", smallest(keep)));
try {
  for (;;) keep.push(build(10, 1));
} catch (error) {
  const last = smallest(keep);
  keep = [];
  parentPort!.postMessage("caught " + (error as Error).name + ": " + (error as Error).message + " behind a tree of " + last);
}
for (;;) keep.push(build(10, 1));
`,
    });
    inPartWithWorkers(test)(
      "a Worker catches its own, and one that it does not catch ends the Worker alone",
      async () => {
        using folder = tempDir("aot-heap-limit", case2);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: expect.stringMatching(
            /^(?=[^]*the Worker says: caught RangeError: Out of memory behind a tree of 1023\n)(?=[^]*the Worker ends with: RangeError Out of memory\n)[^]*exit 1 and the main thread goes on: 100000\n$/,
          ),
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    // A Worker that catches the error goes on, one that does not ends alone, and one that is told and goes on filling ends alone too, where the main thread would end the process.
    const case3 = together("3", {
      "program.ts": `import { Worker as NodeWorker } from "node:worker_threads";
type Entry = { id: number };
function some(): number {
  const list: Entry[] = [];
  for (let i = 0; i < 100_000; i++) list.push({ id: i });
  return list.length;
}
for (const way of ["objects in a try", "objects in a finally", "objects in an async function with a try", "told and goes on filling", "a list in a try", "texts in a try", "closures in a try"]) {
  await new Promise<void>(resolve => {
    const worker = new NodeWorker("./worker.ts", { workerData: way });
    worker.on("message", (said: string) => console.log(way + ": the Worker says:", said));
    worker.on("error", (error: Error) => console.log(way + ": the Worker ends with:", error.name, error.message, error instanceof RangeError));
    worker.on("exit", (code: number) => (console.log(way + ": exit", code, "and the main thread goes on:", some()), resolve()));
  });
}
await new Promise<void>(resolve => {
  const worker = new Worker("./worker.ts", { env: { WAY: "objects in a try" } });
  worker.onmessage = event => console.log("on the web: the Worker says:", event.data);
  worker.onerror = event => (console.log("on the web: the Worker ends with:", event.message), event.preventDefault());
  worker.addEventListener("close", event => (console.log("on the web: close", (event as CloseEvent).code, "and the main thread goes on:", some()), resolve()));
});
`,
      "worker.ts": `import { parentPort, workerData } from "node:worker_threads";
type Entry = { id: number; next: Entry | null };
const way: string = workerData ?? process.env.WAY;
process.on("exit", () => parentPort!.postMessage("an exit listener ran"));
let head: Entry | null = null;
if (way === "objects in a try") {
  try {
    for (let i = 0; ; i++) head = { id: i, next: head };
  } catch (error) {
    head = null;
    parentPort!.postMessage("caught " + error);
  }
} else if (way === "objects in a finally") {
  try {
    for (let i = 0; ; i++) head = { id: i, next: head };
  } finally {
    head = null;
    parentPort!.postMessage("the finally ran");
  }
} else if (way === "objects in an async function with a try") {
  await (async () => {
    try {
      await 0;
    } catch {}
    for (let i = 0; ; i++) head = { id: i, next: head };
  })();
} else if (way === "told and goes on filling") {
  for (;;) {
    try {
      for (let i = 0; ; i++) head = { id: i, next: head };
    } catch {
      let entries = 0;
      for (let entry: Entry | null = head; entry; entry = entry.next) entries++;
      if (entries < 100_000) parentPort!.postMessage("few");
    }
  }
} else if (way === "a list in a try") {
  const list: Entry[] = [];
  try {
    for (let i = 0; ; i++) list.push({ id: i, next: null });
  } catch (error) {
    list.length = 0;
    parentPort!.postMessage("caught " + (error as Error).name);
    process.exit(1);
  }
} else if (way === "texts in a try") {
  const list: string[] = [];
  try {
    for (let i = 0; ; i++) list.push("s" + i + "t");
  } catch (error) {
    list.length = 0;
    parentPort!.postMessage("caught " + (error as Error).name);
    process.exit(1);
  }
} else {
  const list: (() => number)[] = [];
  try {
    for (let i = 0; ; i++) list.push(() => i);
  } catch (error) {
    list.length = 0;
    parentPort!.postMessage("caught " + (error as Error).name);
    process.exit(1);
  }
}
`,
    });
    inPartWithWorkers(test)(
      "a Worker that fills its range inside a try catches the error, and one that does not catch it ends alone",
      async () => {
        using folder = tempDir("aot-heap-limit", case3);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
        // A push may be what finds the memory gone, and it throws: then the Worker catches the error. Either way it is a RangeError, the Worker ends with 1 and nothing else does.
        const lines = stdout
          .split("\n")
          .filter(
            line =>
              !line.endsWith("the Worker says: caught RangeError") &&
              !line.endsWith("the Worker says: an exit listener ran"),
          );
        const alone = (way: string) => [
          `${way}: the Worker ends with: RangeError Out of memory true`,
          `${way}: exit 1 and the main thread goes on: 100000`,
        ];
        const aloneOrCaught = (way: string) => (lines.includes(alone(way)[0]) ? alone(way) : alone(way).slice(1));
        expect({ lines, stderr, exitCode }).toEqual({
          lines: [
            "objects in a try: the Worker says: caught RangeError: Out of memory",
            "objects in a try: exit 0 and the main thread goes on: 100000",
            "objects in a finally: the Worker says: the finally ran",
            ...alone("objects in a finally"),
            ...alone("objects in an async function with a try"),
            ...alone("told and goes on filling"),
            ...aloneOrCaught("a list in a try"),
            ...aloneOrCaught("texts in a try"),
            ...aloneOrCaught("closures in a try"),
            "on the web: the Worker says: caught RangeError: Out of memory",
            "on the web: close 0 and the main thread goes on: 100000",
            "",
          ],
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    const case4 = together("4", {
      "program.ts": `import { Worker } from "node:worker_threads";
const worker = new Worker("./parent.ts");
worker.on("message", (said: string) => console.log(said));
worker.on("error", (error: Error) => console.log("the parent ends with:", error.name, error.message, String(error.stack).split("\\n").slice(0, 3).join(" | ")));
worker.on("exit", (code: number) => console.log("the parent: exit", code));
`,
      "parent.ts": `import { Worker, parentPort } from "node:worker_threads";
const worker = new Worker("./child.ts");
worker.on("error", (error: Error) => parentPort!.postMessage("the child ends with: " + error.name + " " + error.message));
worker.on("exit", (code: number) => parentPort!.postMessage("the child: exit " + code));
`,
      "child.ts": isToldAndGoesOnFilling("String"),
    });
    inPartWithWorkers(test)(
      "a Worker of a Worker that ends so takes neither its parent nor the main thread along",
      async () => {
        using folder = tempDir("aot-heap-limit", case4);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: "the child ends with: RangeError Out of memory\nthe child: exit 1\nthe parent: exit 0\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    inPart(test)(
      "the same program runs to its end in the default range",
      async () => {
        const { stdout, stderr, exitCode } = await start(keepsEverythingProgram);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: "never full 3999999 4000000\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    const keepsLittleProgram = oneOfMany("keeps-little.ts", keepsLittle);
    inPart(test)(
      "garbage does not fill it",
      async () => {
        const { stdout, stderr, exitCode } = await start(keepsLittleProgram, smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "done 15999999\n", stderr: "", exitCode: 0 });
      },
      120_000,
    );

    // Some built-ins make their result where no collection may run: the list of a match is one. A range that such a built-in finds full is collected as soon as collections may run again.
    // It runs many times as long as most. By itself it is built first, and it runs while the others are still being built.
    const letsGoAndFillsAgain = byItself(
      "lets-go-and-fills-again.ts",
      `const names: string[] = [];
for (let i = 0; i < 24; i++) names.push("name" + i);
let keep: unknown[] = [];
const fills: [string, (turns: number, most: number) => void][] = [
  ["cells", (turns, most) => { for (let i = 0; i < turns; i++) { keep.push({ a: i, b: i, c: i }); if (keep.length >= most) keep = []; } }],
  ["storage outside cells", (turns, most) => { for (let i = 0; i < turns; i++) { const object: Record<string, number> = {}; for (let j = 0; j < 24; j++) object[names[j]] = i; keep.push(object); if (keep.length >= most) keep = []; } }],
  ["lists", (turns, most) => { for (let i = 0; i < turns; i++) { const list: number[] = []; for (let j = 0; j < 12; j++) list.push(j); keep.push(list); if (keep.length >= most) keep = []; } }],
  ["strings", (turns, most) => { for (let i = 0; i < turns; i++) { keep.push("text " + i + " and " + i * 3); if (keep.length >= most) keep = []; } }],
  ["matches", (turns, most) => { for (let i = 0; i < turns; i++) { keep.push(/a(b)c/.exec("abc")); if (keep.length >= most) keep = []; } }],
];
// The collector takes every word of the stack for a reference, also what calls that have returned left there, and that may name the list that was let go.
function overwrite(depth: number): number {
  return depth > 0 ? overwrite(depth - 1) + 1 : 0;
}
function run(fill: (turns: number, most: number) => void, turns: number, most: number): number | string {
  keep = [];
  if (overwrite(2000) !== 2000) return "";
  try {
    fill(turns, most);
    return "no error";
  } catch (error) {
    const kept = keep.length;
    keep = [];
    return error instanceof RangeError ? kept : String(error);
  }
}
for (const [what, fill] of fills.slice(0, 4)) {
  const counts = [0, 1, 2].map(() => run(fill, Infinity, Infinity) as number);
  console.log(what, counts[0] > 10_000, counts.map(count => count >= counts[0] * 0.9).join(" "));
}
for (const [what, fill] of fills) console.log(what, (run(fills[0][1], Infinity, Infinity) as number) > 10_000, run(fill, 300_000, 1000));
`,
    );
    inPartFirst(test)(
      "a program that let go of a full range fills it as far again, and what it makes and drops then costs no error",
      async () => {
        const { stdout, stderr, exitCode } = await start(letsGoAndFillsAgain, smallHeap);
        const kinds = ["cells", "storage outside cells", "lists", "strings"];
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout:
            kinds.map(what => `${what} true true true true\n`).join("") +
            [...kinds, "matches"].map(what => `${what} true no error\n`).join(""),
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    // The fill, the error and its catch leave words on the stack that name the list. The frames of what runs next lie over them, and the collector reads every word of a frame, written or not.
    // Which words lie where depends on the frames, so on the processor.
    eachOf(
      test.skipIf(!isLinux || isArm64),
      dealt([
        [
          "a built-in that a loop calls",
          "filled true work 675208 failed 0\n",
          `function mix(sum: number, value: unknown): number {
  return (sum * 31 + String(value).length) % 1000003;
}
function fill(): boolean {
  const kept: unknown[] = [];
  try {
    for (let n = 0; ; n++) {
      kept.push([n + 0.5, n + 1.5, n + 2.5, n + 3.5]);
      if (n >= 3000000) throw new RangeError("enough");
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  return kept.length > 1000;
}
function work(): string {
  let sum = 0;
  let failed = 0;
  for (let turn = 0; turn < 60000; turn++) {
    try {
      sum = mix(sum, Array.from({ length: 5 }, (_, at) => at).length);
    } catch (error) {
      failed++;
    }
  }
  return sum + " failed " + failed;
}
const filled = fill();
const worked = work();
console.log("filled", filled, "work", worked);
export {};
`,
        ],
        [
          "the loop itself",
          "filled true true work 787028 failed 0\n",
          `function mix(sum: number, value: unknown): number {
  return (sum * 31 + String(value).length) % 1000003;
}
let kept: unknown[] = [];
function fillOwnList(): boolean {
  const kept: unknown[] = [];
  try {
    for (let n = 0; ; n++) {
      kept.push({ a: { b: n }, c: [n] });
      if (n >= 3000000) throw new RangeError("enough");
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  return kept.length > 1000;
}
const filledOwnList = fillOwnList();
function fill(kept: unknown[]): boolean {
  try {
    for (let n = 0; ; n++) {
      kept.push([n + 0.5, n + 1.5, n + 2.5, n + 3.5]);
      if (n >= 3000000) throw new RangeError("enough");
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  return kept.length > 1000;
}
function work(): string {
  let sum = 0;
  let failed = 0;
  for (let turn = 0; turn < 60000; turn++) {
    try {
      sum = mix(sum, JSON.stringify({ a: [turn, { b: "x" }] }));
    } catch (error) {
      failed++;
    }
  }
  return sum + " failed " + failed;
}
const filled = fill(kept);
kept = [];
const worked = work();
console.log("filled", filledOwnList, filled, "work", worked);
export {};
`,
        ],
      ]).map(([what, expected, text]) => [
        what,
        expected,
        oneOfMany(fileNamed(what, ".ts"), text, isLinux && !isArm64),
      ]),
    )(
      "behind a fill that was caught and let go there is room for %s",
      async (_, expected, name) => {
        const { stdout, stderr, exitCode } = await start(name, smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
      },
      240_000,
    );

    // A range that stays almost full of objects in use: every collection frees only what was made since the last one, so the program would collect
    // again for every few hundred objects it makes, and hardly move. After a few such collections in a row it gets the error.
    const keepsAFullRange = oneOfMany(
      "keeps-a-full-range.ts",
      `${treeBuilder}let keep: (Tree | null)[] = [];
try {
  for (;;) keep.push(build(10, 1));
} catch (error) {
  console.log("full", (error as Error).name);
}
let told = 0;
let last: unknown;
let nodes = 0;
for (let round = 0; round < 40_000 && told < 3; round++) {
  try {
    nodes += size(build(4, 1));
  } catch (error) {
    told++;
    last = error;
  }
}
// Making an error takes memory too, so one more may come after the last.
let least = -1;
for (let tries = 0; tries < 8 && least < 0; tries++) {
  try {
    least = smallest(keep);
  } catch (error) {
    last = error;
  }
}
keep = [];
console.log("told", told, (last as Error).name, (last as Error).message);
console.log("kept", least);
console.log("afterward", size(build(16, 1)));
`,
    );
    inPart(test)(
      "a program that keeps a full range and goes on making objects is told so, and goes on once it lets go",
      async () => {
        const { stdout, stderr, exitCode } = await start(keepsAFullRange, smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: "full RangeError\ntold 3 RangeError Out of memory\nkept 1023\nafterward 65535\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    const keepsAFullRangeAndGoesOnInATry = (say: string) => `type Entry = { id: number; next: Entry | null };
const kept: Entry[] = [];
function fill() {
  for (let i = 0; ; i++) kept.push({ id: i, next: null });
}
try {
  fill();
} catch (error) {
  ${say}("full " + (error as Error).name);
}
const ring: (Entry | null)[] = new Array(1024).fill(null);
try {
  for (let i = 0; i < 600_000; i++) ring[i & 1023] = { id: i, next: null };
} finally {
  ${say}("finished " + ring[1023]!.id + " " + (kept.length > 100_000));
}
`;

    const keepsAFullRangeInATry = oneOfMany(
      "keeps-a-full-range-in-a-try.ts",
      keepsAFullRangeAndGoesOnInATry("console.log"),
    );
    inPart(test)(
      "inside a try it is told as well",
      async () => {
        const { stdout, stderr, exitCode } = await start(keepsAFullRangeInATry, smallHeap);
        expect({ stdout, stderr: withoutFramesAndVersion(stderr), exitCode }).toEqual({
          stdout: expect.stringMatching(/^full RangeError\nfinished \d+ true\n$/),
          stderr: outOfMemory,
          exitCode: 1,
        });
      },
      120_000,
    );

    const case5 = together("5", {
      "program.ts": `import { Worker } from "node:worker_threads";
type Entry = { id: number };
function some(): number {
  const list: Entry[] = [];
  for (let i = 0; i < 100_000; i++) list.push({ id: i });
  return list.length;
}
await new Promise<void>(resolve => {
  const worker = new Worker("./worker.ts");
  worker.on("message", (said: string) => console.log("the Worker says:", said));
  worker.on("error", (error: Error) => console.log("the Worker ends with:", error.name, error.message));
  worker.on("exit", (code: number) => (console.log("exit", code, "and the main thread goes on:", some()), resolve()));
});
`,
      "worker.ts": `import { parentPort } from "node:worker_threads";
${keepsAFullRangeAndGoesOnInATry("parentPort!.postMessage")}`,
    });
    inPartWithWorkers(test)(
      "a Worker that is told so and does not catch it ends alone",
      async () => {
        using folder = tempDir("aot-heap-limit", case5);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
        expect({ stdout: stdout.replace(/finished \d+/, "finished"), stderr, exitCode }).toEqual({
          stdout:
            "the Worker says: full RangeError\nthe Worker says: finished true\nthe Worker ends with: RangeError Out of memory\nexit 1 and the main thread goes on: 100000\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    const case6 = together("6", twoWorkersThatKeepMoreThanHalfARange);
    inPartWithWorkers(test.skipIf(runsOutOfRoomEarly))(
      "two Workers each keep more alive than half a range holds",
      async () => {
        using folder = tempDir("aot-heap-limit", case6);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run([program], String(folder), {
          BUN_JSC_markedBlockCageSizeInMB: "128",
        });
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: "3002300000,3002300000 2000000000\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    const case7 = together("7", {
      "program.ts": `import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
type Entry = { id: number; next: Entry | null };
const free = () => 64 * 1024 * 1024 - Number(/VmSize:\\s+(\\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"))![1]);
let head: Entry | null = null;
for (let i = 0; i < 100_000; i++) head = { id: i, next: head };
const before = free();
new Worker("./worker.ts").once("message", (sum: number) => {
  const after = free();
  let own = 0;
  for (let entry: Entry | null = head; entry; entry = entry.next) own += entry.id;
  console.log(after > before / 2 ? "shares" : "took " + (before - after) + " kB of " + before, sum, own);
});
`,
      "worker.ts": `import { parentPort } from "node:worker_threads";
type Entry = { id: number; next: Entry | null };
let head: Entry | null = null;
for (let i = 0; i < 100_000; i++) head = { id: i, next: head };
let sum = 0;
for (let entry: Entry | null = head; entry; entry = entry.next) sum += entry.id;
parentPort!.postMessage(sum);
`,
    });
    inPartWithWorkers(test.skipIf(!canLimitAddressSpace))(
      "where address space is limited a Worker shares the range of the main thread",
      async () => {
        using folder = tempDir("aot-heap-limit", case7);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run(withAddressSpaceOf(67108864)(program), String(folder));
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: "shares 4999950000 4999950000\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    const case8 = together("8", {
      "program.ts": `import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
const limit = 8 * 1024 * 1024;
const free = limit - Number(/VmSize:\\s+(\\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"))![1]);
const workers = [1, 2, 3, 4].map(() => new Worker("./worker.ts"));
const sums: number[] = [];
for (const worker of workers) {
  worker.once("message", async (sum: number) => {
    if (sums.push(sum) < workers.length) return;
    await fetch("http://127.0.0.1:1/").catch(() => {});
    console.log(free > limit / 4 ? "roomy" : "only " + free + " kB are free", sums.join());
    for (const each of workers) each.postMessage("end");
  });
}
`,
      "worker.ts": `import { parentPort } from "node:worker_threads";
type Entry = { id: number; next: Entry | null };
let head: Entry | null = null;
for (let i = 0; i < 100_000; i++) head = { id: i, next: head };
let sum = 0;
for (let entry: Entry | null = head; entry; entry = entry.next) sum += entry.id;
await fetch("http://127.0.0.1:1/").catch(() => {});
parentPort!.once("message", () => {});
parentPort!.postMessage(sum);
`,
    });
    inPartWithWorkers(test.skipIf(!canLimitAddressSpace))(
      "where address space is limited much of it is left for Workers and their threads",
      async () => {
        using folder = tempDir("aot-heap-limit", case8);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run(withAddressSpaceOf(8388608)(program), String(folder));
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: "roomy 4999950000,4999950000,4999950000,4999950000\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    // A program that runs under a limit on address space is built by itself: the other programs of an executable take address space.
    const keepsManyObjects = byItself("keeps-many-objects.ts", keepsObjects(45_000_000), canLimitAddressSpace);
    inPart(test.skipIf(!canLimitAddressSpace))(
      "under a limit of 4 GB on address space objects get over a gigabyte",
      async () => {
        const { stdout, stderr, exitCode } = await start(keepsManyObjects, {}, withAddressSpaceOf(4194304));
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "kept 45000000\n", stderr: "", exitCode: 0 });
      },
      120_000,
    );

    const keepsManyBuffers = byItself(
      "keeps-many-buffers.ts",
      `const buffers: ArrayBuffer[] = [];
for (let i = 0; i < 28; i++) buffers.push(new ArrayBuffer(50 * 1024 * 1024));
console.log("kept", buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0) / (1024 * 1024), "MB");
`,
      canLimitAddressSpace,
    );
    inPart(test.skipIf(!canLimitAddressSpace))(
      "and what is no object gets over a gigabyte too",
      async () => {
        const { stdout, stderr, exitCode } = await start(keepsManyBuffers, {}, withAddressSpaceOf(4194304));
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "kept 1400 MB\n", stderr: "", exitCode: 0 });
      },
      120_000,
    );

    const keepsManyObjectsInATry = byItself(
      "keeps-many-objects-in-a-try.ts",
      insideTry(keepsObjects(45_000_000)),
      canLimitAddressSpace,
    );
    // TODO: in about one run of five the process ends with a crash report in place of the sentence. Under the limit the collector's
    // mark stack cannot grow, and whether that or the end of the objects' range comes first differs from run to run.
    inPart(canLimitAddressSpace ? test.todo : test.skip)(
      "a program that fills what a limit on address space leaves says so",
      async () => {
        const { stdout, stderr, exitCode } = await start(
          keepsManyObjectsInATry,
          {},
          withAddressSpaceOf(1048576, "ulimit -c 0 && "),
        );
        expect(stderr).toMatch(
          /FATAL: out of memory\. The limit on address space \(ulimit -v\) leaves no room for more JavaScript objects\. Raise the limit\./,
        );
        expect(stdout).toBe("");
        expect(exitCode).not.toBe(0);
      },
      120_000,
    );

    const makesOneBuffer = byItself(
      "makes-one-buffer.ts",
      `const buffer = new ArrayBuffer(2048 * 1024 * 1024);
console.log("made", buffer.byteLength / (1024 * 1024), "MB");
`,
      canLimitAddressSpace,
    );
    inPart(test.skipIf(!canLimitAddressSpace))(
      "under a limit of 4 GB on address space one buffer gets two gigabytes",
      async () => {
        const { stdout, stderr, exitCode } = await start(makesOneBuffer, {}, withAddressSpaceOf(4194304));
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "made 2048 MB\n", stderr: "", exitCode: 0 });
      },
      120_000,
    );

    const isIdle = byItself(
      "is-idle.ts",
      `import { readFileSync } from "node:fs";
const sizeInKB = Number(/VmSize:\\s+(\\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"))![1]);
console.log(sizeInKB < 2 * 1024 * 1024 ? "less than half" : sizeInKB + " kB");
`,
      canLimitAddressSpace,
    );
    inPart(test.skipIf(!canLimitAddressSpace))(
      "under a limit of 4 GB on address space an idle program reserves less than half of it",
      async () => {
        const { stdout, stderr, exitCode } = await start(isIdle, {}, withAddressSpaceOf(4194304));
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "less than half\n", stderr: "", exitCode: 0 });
      },
      120_000,
    );

    const outgrowsWhatIsReserved = byItself(
      "outgrows-what-is-reserved.ts",
      `type Entry = { id: number; next: Entry | null };
const heads: (Entry | null)[] = [];
for (let chain = 0; chain < 60; chain++) {
  let head: Entry | null = null;
  for (let i = 0; i < 1_000_000; i++) head = { id: i, next: head };
  heads.push(head);
  if (chain % 3 === 2) heads[chain - 1] = null;
}
let entries = 0;
let sum = 0;
for (const head of heads) for (let entry = head; entry; entry = entry.next) (entries++, (sum += entry.id));
console.log(entries, sum);
`,
      canLimitAddressSpace,
    );
    inPart(test.skipIf(!canLimitAddressSpace))(
      "objects that outgrow what is reserved at the start are all still there",
      async () => {
        const { stdout, stderr, exitCode } = await start(outgrowsWhatIsReserved, {}, withAddressSpaceOf(4194304));
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "40000000 19999980000000\n", stderr: "", exitCode: 0 });
      },
      120_000,
    );

    const fillsTheRoomForShapes = oneOfMany(
      "fills-the-room-for-shapes.js",
      `let keep = [];
function fill() {
  for (let i = 0; ; i++) {
    const object = {};
    object["p" + i] = i;
    keep.push(object);
  }
}
for (let attempt = 0; attempt < 2; attempt++) {
  try {
    fill();
  } catch (error) {
    const kept = keep.length;
    keep = [];
    console.log(attempt, error instanceof RangeError, error.message, kept > 100_000);
  }
}
console.log("afterward", Object.keys({ a: 1, b: 2 }).join());
`,
    );
    inPart(test)(
      "a program that fills the room for the shapes of objects gets an error that names it",
      async () => {
        const { stdout, stderr, exitCode } = await start(fillsTheRoomForShapes, {
          BUN_JSC_structureHeapSizeInKB: "65536",
        });
        const message =
          "Out of memory: This executable can use 64 MB for the shapes of JavaScript objects (Structures).";
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: `0 true ${message} true\n1 true ${message} true\nafterward a,b\n`,
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    const fillsTheRoomForShapesAgain = (makeObject: string) => `class Thing { constructor() { this.a = 1; } }
let keep = [];
function fill() {
  for (let i = 0; ; i++) {
    ${makeObject}
    keep.push(object);
  }
}
const kept = [];
for (let attempt = 0; attempt < 4; attempt++) {
  try {
    fill();
  } catch (error) {
    kept.push(keep.length);
    keep = [];
    if (!(error instanceof RangeError)) console.log(String(error));
  }
}
console.log(kept.map(count => count > 10_000 && count * 2 > kept[0]).join());
`;
    eachOf(
      test,
      dealt([
        ["is given a name under a key", `const object = {}; object["p" + i] = i;`],
        [
          "is given a name by Object.defineProperty",
          `const object = {}; Object.defineProperty(object, "p" + i, { value: i });`,
        ],
        ["is a function that is given a name under a key", `const object = function () {}; object["p" + i] = i;`],
        ["is given a prototype", `const object = { a: 1 }; Object.setPrototypeOf(object, {});`],
        ["has a field and is given a name under a key", `const object = { a: 1 }; object["p" + i] = i;`],
        ["is made by a class and is given a name under a key", `const object = new Thing(); object["p" + i] = i;`],
      ]).map(([how, makeObject]) => [how, oneOfMany(fileNamed(how, ".js"), fillsTheRoomForShapesAgain(makeObject))]),
    )(
      "a program that lets go of everything fills the room for the shapes of objects as far again, where each object %s",
      async (_, name) => {
        const { stdout, stderr, exitCode } = await start(name, { BUN_JSC_structureHeapSizeInKB: "16384" });
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "true,true,true,true\n", stderr: "", exitCode: 0 });
      },
      240_000,
    );

    const case9 = together("9", sixWorkersOneAfterTheOther);
    inPartWithWorkers(test.skipIf(!isLinux))(
      "the range of a Worker that has ended is given back",
      async () => {
        using folder = tempDir("aot-heap-limit", case9);
        const { stdout, stderr, exitCode } = await run([await linkTogether(String(folder))], String(folder));
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "given back\n", stderr: "", exitCode: 0 });
      },
      120_000,
    );

    for (const define of [...testsThatRunLongest, ...testsBetween, ...testsOfWorkers]) define();
  });
}
