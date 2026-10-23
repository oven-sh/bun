import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { withoutCoreDump } from "./run-programs";
import { describe, test } from "./supported";

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

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, BUN_CRASH_REPORT_URL: "", ...env });
  // The message of the error goes on with the limit and the option that lifts it. The first test reads all of it; the programs that print a message are compared without.
  return { stdout: stdout.replaceAll(": " + limitOf64MB, ""), stderr, exitCode };
}

async function build(cwd: string, ...moreEntryPoints: string[]) {
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "program.ts", ...moreEntryPoints, "--outfile", "program"],
    cwd,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  return join(cwd, "program");
}

if (isASAN)
  console.error(
    "SKIPPED: heap-limit.test.ts: a Bun built with AddressSanitizer takes the range from another allocator, which does not hand out again at once what is freed, so the reserve that pays for the RangeError does not come back; under `ulimit -v` such a program does not start",
  );

(isASAN ? describe.skip : describe.concurrent)("the address space for objects of a compiled program", () => {
  test("a program that keeps more objects alive than fit ends with a RangeError", async () => {
    using folder = tempDir("aot-heap-limit", { "program.ts": keepsEverything });
    const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
    expect(stderr).toContain("RangeError: Out of memory: " + limitOf64MB);
    expect(stderr).not.toContain("FATAL");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  }, 120_000);

  test("where no error can be thrown it stops and says why", async () => {
    using folder = tempDir("aot-heap-limit", { "program.ts": insideTry(keepsEverything) });
    const program = await build(String(folder));
    const { stdout, stderr, exitCode } = await run(withoutCoreDump([program]), String(folder), smallHeap);
    expect(stderr).toContain("FATAL: out of memory. Each thread of a compiled executable can use 64 MB");
    expect(stderr).toMatch(/Bun (has run|ran) out of memory/);
    expect(stderr).not.toContain("This indicates a bug in Bun");
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  // Where functions are entered, the error comes at the next entry that tests the stack, in a try or not.
  test("a program that fills the range in functions that call themselves catches a RangeError and goes on", async () => {
    using folder = tempDir("aot-heap-limit", { "program.ts": catchesThreeTimes });
    const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "0 true Out of memory 1023\n1 true Out of memory 1023\n2 true Out of memory 1023\nafterward 4095\n",
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);

  test("so does one that calls values nobody knows", async () => {
    using folder = tempDir("aot-heap-limit", { "program.js": callsValuesNobodyKnows });
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "program.js", "--outfile", "program"],
      String(folder),
    );
    expect(built.exitCode).toBe(0);
    const { stdout, stderr, exitCode } = await run([join(String(folder), "program")], String(folder), smallHeap);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "0 true Out of memory true\n1 true Out of memory true\n2 true Out of memory true\nafterward 1\n",
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);

  test("an error that nobody catches ends the process as any other does", async () => {
    using folder = tempDir("aot-heap-limit", {
      "program.ts": `${treeBuilder}const keep: (Tree | null)[] = [];
process.on("exit", (code: number) => console.log("exit", code, smallest(keep)));
for (;;) keep.push(build(10, 1));
`,
    });
    const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
    expect(stderr).toContain("RangeError: Out of memory");
    expect(stderr).not.toContain("FATAL");
    expect({ stdout, exitCode }).toEqual({ stdout: "exit 1 1023\n", exitCode: 1 });
  }, 120_000);

  // A loop that calls nothing enters no function. Its allocations go to the run time for each new block of memory, and there the error is thrown, as long as the function of the loop has no try of its own.
  test("loops that allocate and call nothing get the RangeError where they allocate", async () => {
    using folder = tempDir("aot-heap-limit", {
      "program.ts": `type Pair = { a: number; b: number };
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
    });
    const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
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
  }, 120_000);

  test("what the callers of such a loop have in finally and in using runs", async () => {
    using folder = tempDir("aot-heap-limit", {
      "program.ts": `type Pair = { a: number; b: number };
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
    });
    const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout:
        "finally true\nwithFinally RangeError Out of memory\ndisposed true\nwithUsing RangeError Out of memory\nrejected RangeError Out of memory\nafterward 0\n",
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);

  // Native code that makes an object for each piece of its input enters no function of the program: it asks by itself, once an object, whether the error is owed.
  test("one text or one message with more objects than fit is a RangeError of JSON.parse and of structuredClone", async () => {
    using folder = tempDir("aot-heap-limit", {
      "program.ts": `const text = "[" + '{"a":1,"b":"x"},'.repeat(2_000_000) + '{"a":1}]';
function attempt(what: string, fill: () => unknown[]) {
  try {
    console.log(what, "finished", fill().length);
  } catch (error) {
    console.log(what, (error as Error).name, (error as Error).message);
  }
}
attempt("a text", () => JSON.parse(text));
attempt("a text and a reviver", () => JSON.parse(text, (key, value) => value));
const part: unknown[] = JSON.parse("[" + '{"a":1,"b":2},'.repeat(400_000) + "0]");
attempt("copies", () => {
  const all: unknown[] = [];
  for (let i = 0; i < 6; i++) all.push(structuredClone(part));
  return all;
});
attempt("a small text afterward", () => JSON.parse("[1,2,3]"));
attempt("a small copy afterward", () => structuredClone([1, { a: 2 }]));
`,
    });
    const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout:
        "a text RangeError Out of memory\na text and a reviver RangeError Out of memory\ncopies RangeError Out of memory\na small text afterward finished 3\na small copy afterward finished 2\n",
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);

  test("a Worker that is sent such a text ends alone", async () => {
    using folder = tempDir("aot-heap-limit", {
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
    const program = await build(String(folder), "worker.ts");
    const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
    expect(stderr).not.toContain("FATAL");
    expect({ stdout, exitCode }).toEqual({
      stdout:
        "the Worker says: parsed 2\nthe Worker ends with: RangeError Out of memory\nexit 1 and the main thread goes on: 100001\n",
      exitCode: 0,
    });
  }, 120_000);

  test("a Worker catches its own, and one that it does not catch ends the Worker alone", async () => {
    using folder = tempDir("aot-heap-limit", {
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
    const program = await build(String(folder), "worker.ts");
    const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
    expect(stderr).not.toContain("FATAL");
    expect({ stdout, exitCode }).toEqual({
      stdout: expect.stringMatching(
        /^(?=[^]*the Worker says: caught RangeError: Out of memory behind a tree of 1023\n)(?=[^]*the Worker ends with: RangeError Out of memory\n)[^]*exit 1 and the main thread goes on: 100000\n$/,
      ),
      exitCode: 0,
    });
  }, 120_000);

  // On the main thread such a loop ends the process ("where no error can be thrown it stops and says why"). A Worker's thread can end alone, so it does: the poll of the loop ends it while the last of the memory is used.
  test("where no error can be thrown in a Worker, the Worker ends alone", async () => {
    using folder = tempDir("aot-heap-limit", {
      "program.ts": `import { Worker as NodeWorker } from "node:worker_threads";
type Entry = { id: number };
function some(): number {
  const list: Entry[] = [];
  for (let i = 0; i < 100_000; i++) list.push({ id: i });
  return list.length;
}
for (const way of ["objects in a try", "objects in a finally", "objects in an async function with a try", "a list in a try", "texts in a try", "closures in a try"]) {
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
    const program = await build(String(folder), "worker.ts");
    const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
    expect(stderr).not.toContain("FATAL");
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
    expect({ lines, exitCode }).toEqual({
      lines: [
        ...alone("objects in a try"),
        ...alone("objects in a finally"),
        ...alone("objects in an async function with a try"),
        ...aloneOrCaught("a list in a try"),
        ...aloneOrCaught("texts in a try"),
        ...aloneOrCaught("closures in a try"),
        "on the web: the Worker ends with: RangeError: Out of memory",
        "on the web: close 1 and the main thread goes on: 100000",
        "",
      ],
      exitCode: 0,
    });
  }, 120_000);

  test("a Worker of a Worker that ends so takes neither its parent nor the main thread along", async () => {
    using folder = tempDir("aot-heap-limit", {
      "program.ts": `import { Worker } from "node:worker_threads";
const worker = new Worker("./parent.ts");
worker.on("message", (said: string) => console.log(said));
worker.on("error", (error: Error) => console.log("the parent ends with:", error.name));
worker.on("exit", (code: number) => console.log("the parent: exit", code));
`,
      "parent.ts": `import { Worker, parentPort } from "node:worker_threads";
const worker = new Worker("./child.ts");
worker.on("error", (error: Error) => parentPort!.postMessage("the child ends with: " + error.name + " " + error.message));
worker.on("exit", (code: number) => parentPort!.postMessage("the child: exit " + code));
`,
      "child.ts": `type Entry = { id: number; next: Entry | null };
let head: Entry | null = null;
try {
  for (let i = 0; ; i++) head = { id: i, next: head };
} catch {}
`,
    });
    const program = await build(String(folder), "parent.ts", "child.ts");
    const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
    expect(stderr).not.toContain("FATAL");
    expect({ stdout, exitCode }).toEqual({
      stdout: "the child ends with: RangeError Out of memory\nthe child: exit 1\nthe parent: exit 0\n",
      exitCode: 0,
    });
  }, 120_000);

  test("the same program runs to its end in the default range", async () => {
    using folder = tempDir("aot-heap-limit", { "program.ts": keepsEverything });
    const { stdout, exitCode } = await run([await build(String(folder))], String(folder));
    expect({ stdout, exitCode }).toEqual({ stdout: "never full 3999999 4000000\n", exitCode: 0 });
  }, 120_000);

  test("garbage does not fill it", async () => {
    using folder = tempDir("aot-heap-limit", { "program.ts": keepsLittle });
    const { stdout, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
    expect({ stdout, exitCode }).toEqual({ stdout: "done 15999999\n", exitCode: 0 });
  }, 120_000);

  test("two Workers each keep more alive than half a range holds", async () => {
    using folder = tempDir("aot-heap-limit", twoWorkersThatKeepMoreThanHalfARange);
    const program = await build(String(folder), "worker.ts");
    const { stdout, stderr, exitCode } = await run([program], String(folder), {
      BUN_JSC_markedBlockCageSizeInMB: "128",
    });
    expect(stderr).not.toContain("FATAL");
    expect({ stdout, exitCode }).toEqual({ stdout: "3002300000,3002300000 2000000000\n", exitCode: 0 });
  }, 120_000);

  test.skipIf(!isLinux || isASAN)(
    "where address space is limited a Worker shares the range of the main thread",
    async () => {
      using folder = tempDir("aot-heap-limit", {
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
      await build(String(folder), "worker.ts");
      const { stdout, exitCode } = await run(["sh", "-c", "ulimit -v 67108864 && exec ./program"], String(folder));
      expect({ stdout, exitCode }).toEqual({ stdout: "shares 4999950000 4999950000\n", exitCode: 0 });
    },
    120_000,
  );

  test.skipIf(!isLinux || isASAN)(
    "where address space is limited much of it is left for Workers and their threads",
    async () => {
      using folder = tempDir("aot-heap-limit", {
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
      await build(String(folder), "worker.ts");
      const { stdout, stderr, exitCode } = await run(
        ["sh", "-c", "ulimit -v 8388608 && exec ./program"],
        String(folder),
      );
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: "roomy 4999950000,4999950000,4999950000,4999950000\n",
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.skipIf(!isLinux || isASAN)(
    "under a limit of 4 GB on address space objects get over a gigabyte",
    async () => {
      using folder = tempDir("aot-heap-limit", { "program.ts": keepsObjects(45_000_000) });
      await build(String(folder));
      const { stdout, stderr, exitCode } = await run(
        ["sh", "-c", "ulimit -v 4194304 && exec ./program"],
        String(folder),
      );
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "kept 45000000\n", stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test.skipIf(!isLinux || isASAN)(
    "and what is no object gets over a gigabyte too",
    async () => {
      using folder = tempDir("aot-heap-limit", {
        "program.ts": `const buffers: ArrayBuffer[] = [];
for (let i = 0; i < 28; i++) buffers.push(new ArrayBuffer(50 * 1024 * 1024));
console.log("kept", buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0) / (1024 * 1024), "MB");
`,
      });
      await build(String(folder));
      const { stdout, stderr, exitCode } = await run(
        ["sh", "-c", "ulimit -v 4194304 && exec ./program"],
        String(folder),
      );
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "kept 1400 MB\n", stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test.skipIf(!isLinux || isASAN)(
    "a program that fills what a limit on address space leaves says so",
    async () => {
      using folder = tempDir("aot-heap-limit", { "program.ts": insideTry(keepsObjects(45_000_000)) });
      await build(String(folder));
      const { stdout, stderr, exitCode } = await run(
        ["sh", "-c", "ulimit -c 0 && ulimit -v 1048576 && exec ./program"],
        String(folder),
      );
      expect(stderr).toMatch(
        /FATAL: out of memory\. The limit on address space \(ulimit -v\) leaves no room for more JavaScript objects\. Raise the limit\./,
      );
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    },
    120_000,
  );

  test.skipIf(!isLinux || isASAN)(
    "under a limit of 4 GB on address space one buffer gets two gigabytes",
    async () => {
      using folder = tempDir("aot-heap-limit", {
        "program.ts": `const buffer = new ArrayBuffer(2048 * 1024 * 1024);
console.log("made", buffer.byteLength / (1024 * 1024), "MB");
`,
      });
      await build(String(folder));
      const { stdout, stderr, exitCode } = await run(
        ["sh", "-c", "ulimit -v 4194304 && exec ./program"],
        String(folder),
      );
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "made 2048 MB\n", stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test.skipIf(!isLinux || isASAN)(
    "under a limit of 4 GB on address space an idle program reserves less than half of it",
    async () => {
      using folder = tempDir("aot-heap-limit", {
        "program.ts": `import { readFileSync } from "node:fs";
const sizeInKB = Number(/VmSize:\\s+(\\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"))![1]);
console.log(sizeInKB < 2 * 1024 * 1024 ? "less than half" : sizeInKB + " kB");
`,
      });
      await build(String(folder));
      const { stdout, stderr, exitCode } = await run(
        ["sh", "-c", "ulimit -v 4194304 && exec ./program"],
        String(folder),
      );
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "less than half\n", stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test.skipIf(!isLinux || isASAN)(
    "objects that outgrow what is reserved at the start are all still there",
    async () => {
      using folder = tempDir("aot-heap-limit", {
        "program.ts": `type Entry = { id: number; next: Entry | null };
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
      });
      await build(String(folder));
      const { stdout, stderr, exitCode } = await run(
        ["sh", "-c", "ulimit -v 4194304 && exec ./program"],
        String(folder),
      );
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "40000000 19999980000000\n", stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test.skipIf(isASAN)(
    "a program that fills the room for the shapes of objects gets an error that names it",
    async () => {
      using folder = tempDir("aot-heap-limit", {
        "program.js": `let keep = [];
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
      });
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "program.js", "--outfile", "program"],
        String(folder),
      );
      expect(built.exitCode).toBe(0);
      const { stdout, stderr, exitCode } = await run([join(String(folder), "program")], String(folder), {
        BUN_JSC_structureHeapSizeInKB: "65536",
      });
      const message = "Out of memory: This executable can use 64 MB for the shapes of JavaScript objects (Structures).";
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: `0 true ${message} true\n1 true ${message} true\nafterward a,b\n`,
        stderr: "",
        exitCode: 0,
      });
    },
    240_000,
  );

  test.skipIf(!isLinux)(
    "the range of a Worker that has ended is given back",
    async () => {
      using folder = tempDir("aot-heap-limit", sixWorkersOneAfterTheOther);
      const { stdout, exitCode } = await run([await build(String(folder), "worker.ts")], String(folder));
      expect({ stdout, exitCode }).toEqual({ stdout: "given back\n", exitCode: 0 });
    },
    120_000,
  );
});
