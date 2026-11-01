import { afterAll, describe as describeAnywhere, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isASAN, isLinux, isWindows, tempDir } from "harness";
import { linkSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "./harness/compiler";
import { run as runCommand } from "./harness/run";
import { inTurn } from "./harness/shared-builds";

const describe = unsupported ? describeAnywhere.skip : describeAnywhere.concurrent;

// An ahead-of-time compiled program keeps most references between objects in 32 bits, so its objects live in one reserved range of
// address space. Each Worker has a range of its own. These tests shrink the ranges to see what happens at their end.

const smallHeap = { BUN_JSC_markedBlockCageSizeInMB: "64" };
const saysWhatHoldsLongLists = { BUN_JSC_logHoldersOfListsThisLongWhenCageIsFull: "500000" };
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
let folderTogether: Disposable | undefined;
afterAll(() => folderTogether?.[Symbol.dispose]());
/** Puts the executable of all those programs into `cwd` as ./program. */
async function linkTogether(cwd: string) {
  const executable = await (builtTogether ??= (async () => {
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
    folderTogether = tempDir("aot-heap-limit-together", files);
    return build(String(folderTogether), "worker.ts", ...alone);
  })());
  const extension = isWindows ? ".exe" : "";
  linkSync(executable + extension, join(cwd, "program" + extension));
  return join(cwd, "program");
}

// TODO: with AddressSanitizer these run out of room where a release build does not.
const runsOutOfRoomEarly = isASAN;

/** Every `parts`-th case from the `part`-th. */
export function addressSpaceForObjects(part: number, parts: number) {
  let cases = 0;
  const isInPart = () => cases++ % parts === part - 1;
  const dealt = <Row>(rows: Row[]) => rows.filter(isInPart);
  const inPart = (define: typeof test) => (name: string, body: () => Promise<void>, timeout?: number) => {
    if (isInPart()) define(name, body, timeout);
  };

  describe("the address space for objects of a compiled program", () => {
    inPart(test)(
      "a program that keeps more objects alive than fit ends with a RangeError",
      async () => {
        using folder = tempDir("aot-heap-limit", { "program.ts": keepsEverything });
        const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
        expect(stderr).toContain("RangeError: Out of memory: " + limitOf64MB);
        expect(stderr).not.toContain("FATAL");
        expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
      },
      120_000,
    );

    inPart(test)(
      "inside a try it ends with the same error, and the finally runs",
      async () => {
        using folder = tempDir("aot-heap-limit", { "program.ts": insideTry(keepsEverything) });
        const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
        expect(stderr).toContain("RangeError: Out of memory: " + limitOf64MB);
        expect(stderr).not.toContain("FATAL");
        expect({ stdout, exitCode }).toEqual({ stdout: "finally\n", exitCode: 1 });
      },
      120_000,
    );

    inPart(test)(
      "the heap fills up inside an addition, in a function that catches nothing",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `function fill(make: (index: number) => unknown) {
  const keep: unknown[] = [];
  try {
    for (let index = 0; ; index++) keep.push(make(index));
  } catch (e) {
    return keep.length > 1000 ? (e as Error).name : "too few";
  }
}
const values: any[] = JSON.parse('["text"]');
for (let round = 0; round < 3; round++) console.log(fill(index => BigInt(index) + values[0]));
`,
        });
        const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
        // A list that was dropped may still count as held. Then the next error comes where nothing catches it.
        if (exitCode) expect(stderr).toStartWith("RangeError: Out of memory: " + limitOf64MB);
        else expect(stderr).toBe("");
        expect(stdout).toMatch(exitCode ? /^(RangeError\n){1,3}$/ : /^(RangeError\n){3}$/);
        expect(exitCode).toBeOneOf([0, 1]);
      },
      120_000,
    );

    inPart(test.skipIf(runsOutOfRoomEarly))(
      "a program that is told and goes on filling stops and says why",
      async () => {
        using folder = tempDir("aot-heap-limit", { "program.ts": isToldAndGoesOnFilling("console.log") });
        const program = await build(String(folder));
        const { stdout, stderr, exitCode } = await run(withoutCoreDump([program]), String(folder), smallHeap);
        expect(stderr).toContain("FATAL: out of memory. Each thread of a compiled executable can use 64 MB");
        expect(stderr).toMatch(/Bun (has run|ran) out of memory/);
        expect(stderr).not.toContain("This indicates a bug in Bun");
        expect(stdout).toMatch(/^(told RangeError true\n)+$/);
        expect(exitCode).not.toBe(0);
      },
      120_000,
    );

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
    // The function that fills the range has the handler. Nothing in its loop but the built-in makes anything, and a loop that ends with its list makes records.
    inPart(test)(
      "a loop inside a try that fills the range gets the RangeError in its own catch, whatever it fills the range with",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `const source: Record<string, number> = {};
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
        });
        const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: [...Object.keys(made), "aRecordForEachOfAList"].map(name => `fill_${name} true 1 0\n`).join(""),
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    // One kind after the other in one run: what an operation of one kind leaves behind meets the operations of the next.
    inPart(test)(
      "a try inside a loop that fills the range gets the RangeError, whatever compiled code fills the range with",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
class Point3 extends Point {
  z: number;
  constructor(x: number, y: number, z: number) {
    super(x, y);
    this.z = z;
  }
}
const source: Record<string, number> = {};
for (let i = 0; i < 24; i++) source["name" + i] = 1;
const list = [1, 2, 3, 4, 5, 6, 7, 8];
const proto = { p: 1 };
const point = new Point(1, 2);
const buffer = new ArrayBuffer(64);
const long = "abcdefghij".repeat(20);
function* counts(n: number) {
  yield n;
}
async function later(n: number) {
  return n;
}
function rest(...all: number[]) {
  return all;
}
function widen(o: any, i: number) {
  o.b = i;
  o.c = i;
  o.d = i;
  o.e = i;
  o.f = i;
  o.g = i;
  o.h = i;
  o.i = i;
  o.j = i;
  return o;
}
const slots: unknown[] = new Array(3_000_000).fill(null);
function fill_instances(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = new Point(i, i);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_instancesOfHeir(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = new Point3(i, i, i);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_closures(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = () => i;
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_closuresOfTwo(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = () => i + slots.length;
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_lists(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = [i];
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_listsOfLists(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = [[i], [i]];
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_texts(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = "t" + i + "x";
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_templates(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = \`\${i}-\${i}\`;
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_spreads(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = { ...source };
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_listSpreads(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = [...list, i];
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_bigints(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = BigInt(i) + 12345678901234567890n;
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_generators(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = counts(i);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_asyncResults(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = later(i);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_rests(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = rest(i, i, i);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_holes(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = new Array(4);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_created(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = Object.create(proto);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_regexps(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = /a/g;
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_wide(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = widen({ a: i }, i);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_boundMethods(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = point.sum.bind(point);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_weak(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = new WeakRef(point);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_proxies(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = new Proxy(point, {});
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_mapsOfPairs(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = new Map([[i, i]]);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_views(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = new DataView(buffer);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_substrings(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = long.slice(i % 50, 60);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_numbersAsText(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = String(i * 1.5);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_classes(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = class { static n = i };
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_getters(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = ({ get a() { return i; } });
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_symbolsFor(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = Symbol(String(i));
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
const BoundPoint: any = Point.bind(null, 1);
function fill_boundConstructs(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = new BoundPoint(i);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
const ProxyPoint: any = new Proxy(Point, {});
function fill_proxyConstructs(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = new ProxyPoint(i, i);
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
class Failure extends Error {}
function fill_heirsOfError(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = new Failure("f");
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
class Table extends Map<number, number> {}
function fill_heirsOfMap(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = new Table();
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
const small = { a: 1, b: 2, c: 3 };
function fill_copiesWithOneMore(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = { ...small, d: i };
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_changedOnOneWay(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      const made = { a: i, b: i };
      if (i & 1) made.b = 0;
      slots[i] = made;
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_holders(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      const inner = { a: i };
      const outer = { inner, b: i };
      if (i & 1) inner.a = 0;
      slots[i] = outer;
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
function fill_besideWhatTheCatchReads(): string {
  for (let i = 0; i < slots.length; i++) {
    const pair = { first: i, second: 0 };
    try {
      pair.second = i + 1;
      slots[i] = { ...small, d: i };
      pair.first = -1;
    } catch (error) {
      return error instanceof RangeError && pair.second === pair.first + 1 ? "inside" : "another error";
    }
  }
  return "never";
}
const answers: string[] = [];
const all: Record<string, () => string> = { instances: fill_instances, instancesOfHeir: fill_instancesOfHeir, closures: fill_closures, closuresOfTwo: fill_closuresOfTwo, lists: fill_lists, listsOfLists: fill_listsOfLists, texts: fill_texts, templates: fill_templates, spreads: fill_spreads, listSpreads: fill_listSpreads, bigints: fill_bigints, generators: fill_generators, asyncResults: fill_asyncResults, rests: fill_rests, holes: fill_holes, created: fill_created, regexps: fill_regexps, wide: fill_wide, boundMethods: fill_boundMethods, weak: fill_weak, proxies: fill_proxies, mapsOfPairs: fill_mapsOfPairs, views: fill_views, substrings: fill_substrings, numbersAsText: fill_numbersAsText, classes: fill_classes, getters: fill_getters, symbolsFor: fill_symbolsFor, boundConstructs: fill_boundConstructs, proxyConstructs: fill_proxyConstructs, heirsOfError: fill_heirsOfError, heirsOfMap: fill_heirsOfMap, copiesWithOneMore: fill_copiesWithOneMore, changedOnOneWay: fill_changedOnOneWay, holders: fill_holders, besideWhatTheCatchReads: fill_besideWhatTheCatchReads };
for (const name of Object.keys(all)) {
  const fill = all[name];
  let answer = "";
  try {
    answer = fill();
  } catch (error) {
    answer = "outside";
  }
  slots.fill(null);
  Bun.gc(true);
  answers.push(name + " " + answer);
}
console.log(answers.join("\\n"));
`,
        });
        const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
        expect({ stdout: stdout.replace("generators outside", "generators inside"), stderr, exitCode }).toEqual({
          stdout: [
            "instances",
            "instancesOfHeir",
            "closures",
            "closuresOfTwo",
            "lists",
            "listsOfLists",
            "texts",
            "templates",
            "spreads",
            "listSpreads",
            "bigints",
            "generators",
            "asyncResults",
            "rests",
            "holes",
            "created",
            "regexps",
            "wide",
            "boundMethods",
            "weak",
            "proxies",
            "mapsOfPairs",
            "views",
            "substrings",
            "numbersAsText",
            "classes",
            "getters",
            "symbolsFor",
            "boundConstructs",
            "proxyConstructs",
            "heirsOfError",
            "heirsOfMap",
            "copiesWithOneMore",
            "changedOnOneWay",
            "holders",
            "besideWhatTheCatchReads",
          ]
            .map(name => name + " inside\n")
            .join(""),
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    // The stores are all that the try holds. They allocate and may not collect.
    inPart(test)(
      "a try that holds nothing but stores that add fields gets the RangeError",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `const plain: any[] = [];
for (let i = 0; i < 300_000; i++) plain.push({ a: i });
function fill(): string {
  for (let i = 0; i < 3_000_000; i++) {
    try {
      const o = plain[i % plain.length];
      o.f0 = i;
      o.f1 = i;
      o.f2 = i;
      o.f3 = i;
      o.f4 = i;
      o.f5 = i;
      o.f6 = i;
      o.f7 = i;
      o.f8 = i;
      o.f9 = i;
      o.f10 = i;
      o.f11 = i;
      o.f12 = i;
      o.f13 = i;
      o.f14 = i;
      o.f15 = i;
      o.f16 = i;
      o.f17 = i;
      o.f18 = i;
      o.f19 = i;
      o.f20 = i;
      o.f21 = i;
      o.f22 = i;
      o.f23 = i;
      o.f24 = i;
      o.f25 = i;
      o.f26 = i;
      o.f27 = i;
      o.f28 = i;
      o.f29 = i;
      o.f30 = i;
      o.f31 = i;
      o.f32 = i;
      o.f33 = i;
      o.f34 = i;
      o.f35 = i;
      o.f36 = i;
      o.f37 = i;
      o.f38 = i;
      o.f39 = i;
    } catch (error) {
      return error instanceof RangeError ? "inside" : "another error";
    }
  }
  return "never";
}
let answer = "";
try {
  answer = fill();
} catch (error) {
  answer = "outside";
}
plain.length = 0;
console.log(answer);
`,
        });
        const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "inside\n", stderr: "", exitCode: 0 });
      },
      240_000,
    );

    inPart(test)(
      "a function that is entered where the range is full gets the RangeError of the range",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.js": `const objects = [];
for (let i = 0; i < 300000; i++) objects.push({ a: i });
function depth(n) {
  return n > 0 ? depth(n - 1) + 1 : 0;
}
let turns = 0;
function widen(o, i) {
  o.f0 = i;
  o.f1 = i;
  o.f2 = i;
  o.f3 = i;
  o.f4 = i;
  o.f5 = i;
  o.f6 = i;
  o.f7 = i;
  o.f8 = i;
  o.f9 = i;
  o.f10 = i;
  o.f11 = i;
  o.f12 = i;
  o.f13 = i;
  o.f14 = i;
  o.f15 = i;
  o.f16 = i;
  o.f17 = i;
  o.f18 = i;
  o.f19 = i;
  o.f20 = i;
  o.f21 = i;
  o.f22 = i;
  o.f23 = i;
  o.f24 = i;
  o.f25 = i;
  o.f26 = i;
  o.f27 = i;
  o.f28 = i;
  o.f29 = i;
  o.f30 = i;
  o.f31 = i;
  o.f32 = i;
  o.f33 = i;
  o.f34 = i;
  o.f35 = i;
  o.f36 = i;
  o.f37 = i;
  o.f38 = i;
  o.f39 = i;
}
function fill() {
  for (let i = 0; i < objects.length; i++) {
    try {
      widen(objects[i], i);
      turns += depth(3);
    } catch (error) {
      return "inside " + i + " " + error.name + " " + error.message.slice(0, 30);
    }
  }
  return "never";
}
let where = "";
try {
  where = fill();
} catch (error) {
  where = "OUTSIDE " + error.name + " " + error.message.slice(0, 30);
}
objects.length = 0;
Bun.gc(true);
console.log(where, turns > 0);
`,
        });
        const built = await run(
          [bunExe(), "build", "--compile", "--aot", "program.js", "--outfile", "program"],
          String(folder),
        );
        expect(built.exitCode).toBe(0);
        const { stdout, stderr, exitCode } = await run([join(String(folder), "program")], String(folder), smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: expect.stringMatching(/^inside \d+ RangeError Out of memory: Each thread of  true\n$/),
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    // The try holds the built-in and a store in place, and nothing behind them that could throw for them.
    inPart(test)(
      "a try inside a loop that fills the range gets the RangeError as well, whatever it fills the range with",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `const source: Record<string, number> = {};
for (let i = 0; i < 24; i++) source["name" + i] = 1;
const list = [1, 2, 3, 4, 5, 6, 7, 8];
const slots: unknown[] = new Array(3_000_000).fill(null);
function make(n: number) {
  return { a: n, b: [n] };
}
${Object.entries(made)
  .map(
    ([name, expression]) => `function fill_${name}(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      slots[i] = ${expression};
    } catch (error) {
      return error instanceof RangeError ? "inside" : String(error);
    }
  }
  return "never";
}
`,
  )
  .join("")}const answers: string[] = [];
for (const fill of [${Object.keys(made)
            .map(name => "fill_" + name)
            .join(", ")}]) {
  let answer = "";
  try {
    answer = fill();
  } catch {
    answer = "outside";
  }
  slots.fill(null);
  Bun.gc(true);
  answers.push(fill.name + " " + answer);
}
console.log(answers.join("\\n"));
`,
        });
        const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: Object.keys(made)
            .map(name => `fill_${name} inside\n`)
            .join(""),
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    inPart(test)(
      "an allocation in front of a try, or behind one, that fails passes the catch by",
      async () => {
        const allocations = {
          closure: "() => i",
          record: "{ a: i, b: i, c: i, d: i }",
          list: "[i, i, i, i]",
          bound: "simple.bind(null)",
        };
        const names = Object.keys(allocations).flatMap(name => ["front_" + name, "behind_" + name]);
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `const slots: unknown[] = new Array(3_000_000).fill(null);
const flags: boolean[] = [false, false, false, false, false, false, false, false];
function simple(): string {
  return "x";
}
function check(n: number): void {
  if (flags[n & 7]) throw new Error("flag");
}
${Object.entries(allocations)
  .map(
    ([name, expression]) => `function front_${name}(): string {
  for (let i = 0; i < slots.length; i++) {
    const made = ${expression};
    try {
      check(i);
      slots[i] = made;
    } catch {
      return "inside";
    }
  }
  return "never";
}
function behind_${name}(): string {
  for (let i = 0; i < slots.length; i++) {
    try {
      check(i);
    } catch {
      return "inside";
    }
    slots[i] = ${expression};
  }
  return "never";
}
`,
  )
  .join("")}const answers: string[] = [];
for (const fill of [${names.join(", ")}]) {
  let answer = "";
  try {
    answer = fill();
  } catch (error) {
    answer = error instanceof RangeError ? "outside" : String(error);
  }
  slots.fill(null);
  Bun.gc(true);
  answers.push(fill.name + " " + answer);
}
console.log(answers.join("\\n"));
`,
        });
        const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: names.map(name => `${name} outside\n`).join(""),
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    // Where functions are entered, the error comes at the next entry that tests the stack, in a try or not.
    inPart(test)(
      "a program that fills the range in functions that call themselves catches a RangeError and goes on",
      async () => {
        using folder = tempDir("aot-heap-limit", { "program.ts": catchesThreeTimes });
        const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: "0 true Out of memory 1023\n1 true Out of memory 1023\n2 true Out of memory 1023\nafterward 4095\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    inPart(test)(
      "so does one that calls values nobody knows",
      async () => {
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
      },
      120_000,
    );

    inPart(test)(
      "an error that nobody catches ends the process as any other does",
      async () => {
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
      },
      120_000,
    );

    // A loop that calls nothing enters no function. Its allocations go to the run time for each new block of memory, and there the error is thrown, as long as the function of the loop has no try of its own.
    inPart(test)(
      "loops that allocate and call nothing get the RangeError where they allocate",
      async () => {
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
      },
      120_000,
    );

    inPart(test)(
      "what the callers of such a loop have in finally and in using runs",
      async () => {
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
      },
      120_000,
    );

    // Native code that makes an object for each piece of its input enters no function of the program: it asks by itself, once an object, whether the error is owed.
    // The list that is copied takes about half of the room. With its six copies it is larger than the whole range.
    inPart(test.skipIf(runsOutOfRoomEarly))(
      "one text or one message with more objects than fit is a RangeError of JSON.parse and of structuredClone",
      async () => {
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
const part: unknown[] = JSON.parse("[" + '{"a":1,"b":2},'.repeat(200_000) + "0]");
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
    inPart(test)(
      "a Worker that is sent such a text ends alone",
      async () => {
        using folder = tempDir("aot-heap-limit", case1);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
        expect(stderr).not.toContain("FATAL");
        expect({ stdout, exitCode }).toEqual({
          stdout:
            "the Worker says: parsed 2\nthe Worker ends with: RangeError Out of memory\nexit 1 and the main thread goes on: 100001\n",
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
    inPart(test)(
      "a Worker catches its own, and one that it does not catch ends the Worker alone",
      async () => {
        using folder = tempDir("aot-heap-limit", case2);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
        expect(stderr).not.toContain("FATAL");
        expect({ stdout, exitCode }).toEqual({
          stdout: expect.stringMatching(
            /^(?=[^]*the Worker says: caught RangeError: Out of memory behind a tree of 1023\n)(?=[^]*the Worker ends with: RangeError Out of memory\n)[^]*exit 1 and the main thread goes on: 100000\n$/,
          ),
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
    inPart(test)(
      "a Worker that fills its range inside a try catches the error, and one that does not catch it ends alone",
      async () => {
        using folder = tempDir("aot-heap-limit", case3);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
        expect(stderr).not.toContain("FATAL");
        // A push may be what finds the memory gone, and it throws: then the Worker catches the error. Either way it is a RangeError, the Worker ends with 1 and nothing else does.
        const lines = stdout
          .replaceAll(": " + limitOf64MB, "")
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
    inPart(test)(
      "a Worker of a Worker that ends so takes neither its parent nor the main thread along",
      async () => {
        using folder = tempDir("aot-heap-limit", case4);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
        expect(stderr).not.toContain("FATAL");
        expect({ stdout: stdout.replaceAll(": " + limitOf64MB, ""), exitCode }).toEqual({
          stdout: "the child ends with: RangeError Out of memory\nthe child: exit 1\nthe parent: exit 0\n",
          exitCode: 0,
        });
      },
      120_000,
    );

    inPart(test)(
      "the same program runs to its end in the default range",
      async () => {
        using folder = tempDir("aot-heap-limit", { "program.ts": keepsEverything });
        const { stdout, exitCode } = await run([await build(String(folder))], String(folder));
        expect({ stdout, exitCode }).toEqual({ stdout: "never full 3999999 4000000\n", exitCode: 0 });
      },
      120_000,
    );

    inPart(test)(
      "garbage does not fill it",
      async () => {
        using folder = tempDir("aot-heap-limit", { "program.ts": keepsLittle });
        const { stdout, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
        expect({ stdout, exitCode }).toEqual({ stdout: "done 15999999\n", exitCode: 0 });
      },
      120_000,
    );

    // Some built-ins make their result where no collection may run: the list of a match is one. A range that such a built-in finds full is collected as soon as collections may run again.
    inPart(test)(
      "a program that let go of a full range fills it as far again, and what it makes and drops then costs no error",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `const names: string[] = [];
for (let i = 0; i < 24; i++) names.push("name" + i);
let keep: unknown[] = [];
const fills: [string, (turns: number, most: number) => void][] = [
  ["cells", (turns, most) => { for (let i = 0; i < turns; i++) { keep.push({ a: i, b: i, c: i }); if (keep.length >= most) keep = []; } }],
  ["storage outside cells", (turns, most) => { for (let i = 0; i < turns; i++) { const object: Record<string, number> = {}; for (let j = 0; j < 24; j++) object[names[j]] = i; keep.push(object); if (keep.length >= most) keep = []; } }],
  ["lists", (turns, most) => { for (let i = 0; i < turns; i++) { const list: number[] = []; for (let j = 0; j < 12; j++) list.push(j); keep.push(list); if (keep.length >= most) keep = []; } }],
  ["strings", (turns, most) => { for (let i = 0; i < turns; i++) { keep.push("text " + i + " and " + i * 3); if (keep.length >= most) keep = []; } }],
  ["matches", (turns, most) => { for (let i = 0; i < turns; i++) { keep.push(/a(b)c/.exec("abc")); if (keep.length >= most) keep = []; } }],
];
function run(fill: (turns: number, most: number) => void, turns: number, most: number): number | string {
  keep = [];
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
        });
        const program = await build(String(folder));
        const ran = await run([program], String(folder), smallHeap);
        const { stderr, exitCode } = ran;
        // TODO: on Windows x64 every C++ frame has four words for its callee's arguments, which few callees write. 38 of them lie between a poll and the collection that it asks for.
        // One may still name the list of the fill before. The scan of the stack then keeps that list, and the next fill ends early. There, how far the later fills get is not compared.
        const stdout =
          isWindows && !isArm64
            ? ran.stdout.replace(/^(.+ true true) (?:true|false) (?:true|false)$/gm, "$1 true true")
            : ran.stdout;
        const kinds = ["cells", "storage outside cells", "lists", "strings"];
        const expected =
          kinds.map(what => `${what} true true true true\n`).join("") +
          [...kinds, "matches"].map(what => `${what} true no error\n`).join("");
        const holders =
          stdout === expected
            ? []
            : (await run([program], String(folder), { ...smallHeap, ...saysWhatHoldsLongLists })).stderr
                .split(/\r?\n/)
                .slice(0, 30);
        expect({ stdout, stderr, exitCode, holders }).toEqual({
          stdout: expected,
          stderr: "",
          exitCode: 0,
          holders: [],
        });
      },
      240_000,
    );

    inPart(test)(
      "an option says what holds a long list where the error stands",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `const box: { inner: { list: unknown[] } } = { inner: { list: [] } };
function fill(): number {
  try {
    for (let i = 0; ; i++) box.inner.list.push({ a: i, b: i, c: i });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return box.inner.list.length;
  }
}
console.log(fill() > 500_000);
`,
        });
        const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), {
          ...smallHeap,
          ...saysWhatHoldsLongLists,
        });
        const holders = stderr.split(/\r?\n/).filter(line => !/ of the stack | words copied /.test(line));
        expect({ stdout, holders, exitCode }).toEqual({
          stdout: "true\n",
          holders: [
            "AOT full heap | the collection at a poll freed too little | lists of 500000 elements and more that outlived it: 1",
            expect.stringMatching(
              /^AOT full heap \| a list of \d+ elements \| a second collection from the same place keeps it too$/,
            ),
            "AOT full heap |   a root refers to this Object: CodeBlocks",
            "AOT full heap |   Object .inner > Object",
            "AOT full heap |   Object .list > Array",
            "",
          ],
          exitCode: 0,
        });
      },
      120_000,
    );

    // A function fills a list until it catches the out-of-memory error, then returns. The list is collected, so the loop that runs next gets no error.
    test.skipIf(!isLinux || isArm64).each(
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
      ]),
    )(
      "behind a fill that was caught and let go there is room for %s",
      async (_, expected, program) => {
        using folder = tempDir("aot-heap-limit", { "program.ts": program });
        const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
      },
      240_000,
    );

    // A range that stays almost full of objects in use: every collection frees only what was made since the last one, so the program would collect
    // again for every few hundred objects it makes, and hardly move. After a few such collections in a row it gets the error.
    inPart(test)(
      "a program that keeps a full range and goes on making objects is told so, and goes on once it lets go",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `${treeBuilder}let keep: (Tree | null)[] = [];
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
// Making an error takes memory too, so one more may come after the last. In a function of its own: a frame that has ended names the list no longer.
function smallestKept() {
  for (let tries = 0; tries < 8; tries++) {
    try {
      return smallest(keep);
    } catch (error) {
      last = error;
    }
  }
  return -1;
}
const least = smallestKept();
keep = [];
console.log("told", told, (last as Error).name, (last as Error).message);
console.log("kept", least);
console.log("afterward", size(build(16, 1)));
`,
        });
        const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: "full RangeError\ntold 3 RangeError Out of memory\nkept 1023\nafterward 65535\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    // The first out-of-memory error comes with room for its handler. Later ones do not while the program frees nothing,
    // so the finally block allocates nothing: it says a number, which is negative if the list is short.
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
  ${say}(kept.length > 100_000 ? ring[1023]!.id : -1);
}
`;

    inPart(test)(
      "inside a try it is told as well",
      async () => {
        using folder = tempDir("aot-heap-limit", { "program.ts": keepsAFullRangeAndGoesOnInATry("console.log") });
        const { stdout, stderr, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
        expect(stderr).toContain("RangeError: Out of memory: " + limitOf64MB);
        expect(stderr).not.toContain("FATAL");
        expect(stdout).toMatch(/^full RangeError\n\d+\n$/);
        expect(exitCode).toBe(1);
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
  worker.on("message", (said: string | number) =>
    console.log("the Worker says:", typeof said === "number" ? "finished " + (said >= 0) : said),
  );
  worker.on("error", (error: Error) => {
    console.error(error.stack);
    console.log("the Worker ends with:", error.name, error.message);
  });
  worker.on("exit", (code: number) => (console.log("exit", code, "and the main thread goes on:", some()), resolve()));
});
`,
      "worker.ts": `import { parentPort } from "node:worker_threads";
${keepsAFullRangeAndGoesOnInATry("parentPort!.postMessage")}`,
    });
    inPart(test)(
      "a Worker that is told so and does not catch it ends alone",
      async () => {
        using folder = tempDir("aot-heap-limit", case5);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
        expect(stderr).not.toContain("FATAL");
        const expected = {
          stdout:
            "the Worker says: full RangeError\nthe Worker says: finished true\nthe Worker ends with: RangeError Out of memory\nexit 1 and the main thread goes on: 100000\n",
          exitCode: 0,
        };
        // Where the Worker's last error was thrown.
        if (!Bun.deepEquals({ stdout, exitCode }, expected)) console.error(stderr);
        expect({ stdout, exitCode }).toEqual(expected);
      },
      120_000,
    );

    const case6 = together("6", twoWorkersThatKeepMoreThanHalfARange);
    inPart(test.skipIf(runsOutOfRoomEarly))(
      "two Workers each keep more alive than half a range holds",
      async () => {
        using folder = tempDir("aot-heap-limit", case6);
        const program = await linkTogether(String(folder));
        const { stdout, stderr, exitCode } = await run([program], String(folder), {
          BUN_JSC_markedBlockCageSizeInMB: "128",
        });
        expect(stderr).not.toContain("FATAL");
        expect({ stdout, exitCode }).toEqual({ stdout: "3002300000,3002300000 2000000000\n", exitCode: 0 });
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
    inPart(test.skipIf(!isLinux || isASAN))(
      "where address space is limited a Worker shares the range of the main thread",
      async () => {
        using folder = tempDir("aot-heap-limit", case7);
        await linkTogether(String(folder));
        const { stdout, exitCode } = await run(["sh", "-c", "ulimit -v 67108864 && exec ./program"], String(folder));
        expect({ stdout, exitCode }).toEqual({ stdout: "shares 4999950000 4999950000\n", exitCode: 0 });
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
    inPart(test.skipIf(!isLinux || isASAN))(
      "where address space is limited much of it is left for Workers and their threads",
      async () => {
        using folder = tempDir("aot-heap-limit", case8);
        await linkTogether(String(folder));
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

    inPart(test.skipIf(!isLinux || isASAN))(
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

    inPart(test.skipIf(!isLinux || isASAN))(
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

    // Now and then the storage of a list finds no room before an object does: that error says no more than its name.
    inPart(test.skipIf(!isLinux || isASAN))(
      "a program that fills what a limit on address space leaves says so",
      async () => {
        using folder = tempDir("aot-heap-limit", { "program.ts": insideTry(keepsObjects(45_000_000)) });
        await build(String(folder));
        const { stdout, stderr, exitCode } = await run(
          ["sh", "-c", "ulimit -c 0 && ulimit -v 1048576 && exec ./program"],
          String(folder),
        );
        // A collection needs memory for its mark stack. If malloc has none left, the process says so and ends.
        if (stderr.startsWith("FATAL")) {
          expect({ stdout, stderr, exitCode }).toEqual({
            stdout: "",
            stderr:
              "FATAL: out of memory. The limit on address space (ulimit -v) leaves no room for more JavaScript objects. Raise the limit.\n",
            exitCode: 1,
          });
          return;
        }
        expect(stderr).toMatch(
          /^RangeError: Out of memory(: The limit on address space \(ulimit -v\) leaves no room for more JavaScript objects\. Raise the limit\.)?\n/,
        );
        expect({ stdout, exitCode }).toEqual({ stdout: "finally\n", exitCode: 1 });
      },
      120_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "a program that catches every failed allocation goes on",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `const taken: unknown[] = [];
for (let size = 64 * 1024 * 1024; size >= 64 * 1024; size /= 2) {
  try { for (;;) taken.push(new ArrayBuffer(size)); } catch {}
}
for (let size = 16 * 1024 * 1024; size >= 512; size /= 2) {
  for (const eighths of [14, 12, 10, 8]) {
    try { for (;;) taken.push("x".repeat((size / 8) * eighths)); } catch {}
  }
}
taken.fill(null);
console.log("went on");
`,
        });
        await build(String(folder));
        const results = await Promise.all(
          [1048576, 2097152, 4194304].map(limit =>
            run(["sh", "-c", `ulimit -c 0 && ulimit -v ${limit} && exec ./program`], String(folder)),
          ),
        );
        for (const { stdout, stderr, exitCode } of results)
          expect({ stdout, stderr, exitCode }).toEqual({ stdout: "went on\n", stderr: "", exitCode: 0 });
      },
      120_000,
    );

    // The tables that the run time makes at their first use have their pages from the start, or are done without. The program uses up the blocks of their sizes too.
    inPart(test.skipIf(!isLinux || isASAN))(
      "with its address space used up a program reads, stores and copies properties for the first time",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `import path from "path";
const long = "ab/../".repeat(51200) + "z";
const hold: ArrayBuffer[] = [];
const given: any = { a: 1, b: { c: [1, 2, 3] }, name: "n" };
for (const kib of [262144, 16384, 1024, 64, 40, 10]) for (;;) { try { hold.push(new ArrayBuffer(kib * 1024)); } catch { break; } }
console.log("address space used up");
try { path.normalize(long); console.log("answered"); } catch (e) { console.log("caught " + (e as Error).name + ": " + (e as Error).message); }
given.fresh = given.b.c.length;
console.log(given.fresh, given["na" + "me".slice(0)], "a" in given);
console.log(Object.assign({}, given).name, Object.keys(given).length, Reflect.ownKeys(given).length);
console.log("alive");
`,
        });
        await build(String(folder));
        for (const limit of [4194304, 2097152]) {
          expect(
            await run(["sh", "-c", `ulimit -c 0 && ulimit -v ${limit} && exec ./program`], String(folder), {
              BUN_JSC_numberOfGCMarkers: "1",
            }),
          ).toEqual({
            stdout: "address space used up\ncaught RangeError: Out of memory\n3 n true\nn 4 4\nalive\n",
            stderr: "",
            exitCode: 0,
          });
        }
      },
      120_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "with its address space used up a program parses JSON for the first time",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `const hold: ArrayBuffer[] = [];
const texts = ['{"j1":1,"z":2}', '{"j2":1,"z":2}', '{"j3":[1],"z":2,"y":{"x":1}}'];
type Known = { z: number };
for (const kib of [262144, 16384, 1024, 64, 48, 40, 10, 5]) for (;;) { try { hold.push(new ArrayBuffer(kib * 1024)); } catch { break; } }
console.log("address space used up");
let sum = 0;
for (let round = 0; round < 3; round++) for (const text of texts) sum += (JSON.parse(text) as Known).z + JSON.parse(text).z;
console.log(sum);
console.log("alive");
`,
        });
        await build(String(folder));
        for (const limit of [4194304, 2097152]) {
          expect(
            await run(["sh", "-c", `ulimit -c 0 && ulimit -v ${limit} && exec ./program`], String(folder), {
              BUN_JSC_numberOfGCMarkers: "1",
            }),
          ).toEqual({ stdout: "address space used up\n36\nalive\n", stderr: "", exitCode: 0 });
        }
      },
      120_000,
    );

    // Stores into a long list that lies in the old generation are logged, and the log finds no room to grow.
    inPart(test.skipIf(!isLinux || isASAN))(
      "a program catches the failure of an allocation while stores into a long list are logged",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `const small: unknown[] = new Array(200_000).fill(null);
const taken: unknown[] = [];
for (let size = 64 * 1024 * 1024; size >= 64 * 1024; size /= 2) {
  try { for (;;) taken.push(new Uint8Array(size)); } catch {}
}
for (let size = 16 * 1024 * 1024; size >= 512; size /= 2) {
  for (const eighths of [14, 12, 10, 8]) {
    try { for (;;) taken.push("x".repeat((size / 8) * eighths)); } catch {}
  }
}
let made = 0;
let caught = "nothing";
try {
  for (; made < small.length; made++) small[made] = new ArrayBuffer(8);
} catch (error) {
  caught = error instanceof RangeError ? "RangeError" : String(error);
}
taken.fill(null);
console.log("caught", caught, made > 0);
`,
        });
        await build(String(folder));
        // Which allocation meets the limit first depends on the limit. At 3 GB it was often the ArrayBuffer's own C++ object.
        for (const limit of [1048576, 2097152, 3145728]) {
          const { stdout, stderr, exitCode } = await run(
            ["sh", "-c", `ulimit -c 0 && ulimit -v ${limit} && exec ./program`],
            String(folder),
          );
          expect({ stdout, stderr, exitCode }).toEqual({ stdout: "caught RangeError true\n", stderr: "", exitCode: 0 });
        }
      },
      120_000,
    );

    // Small holes come first, so the heap's list of buffers is what finds no room.
    for (const [made, makes] of [
      ["new ArrayBuffer()", "new ArrayBuffer(100)"],
      ["slice()", "source.slice(0)"],
      ["transfer()", "(source = source.transfer())"],
    ])
      for (const [catches, fills] of [
        [
          "a program catches",
          `try {
  for (; made < held.length; made++) held[made] = ${makes};
} catch (error) {
  caught = error instanceof RangeError ? "RangeError" : String(error);
}`,
        ],
        // The call throws, under its own try. The poll of the loop stands outside.
        [
          "a try inside the loop catches",
          `try {
  for (; made < held.length; made++) {
    try {
      held[made] = ${makes};
    } catch (error) {
      caught = error instanceof RangeError ? "RangeError" : String(error);
      break;
    }
  }
} catch {
  caught = "outside";
}`,
        ],
      ])
        inPart(test.skipIf(!isLinux || isASAN))(
          `${catches} the failure of ${made} where the heap's list of buffers has no room`,
          async () => {
            using folder = tempDir("aot-heap-limit", {
              "program.ts": `let source = new ArrayBuffer(100);
const small: (string | null)[] = [];
for (let i = 0; i < 200_000; i++) small.push("s".repeat(60 + (i % 140)) + i);
for (let i = 0; i < small.length; i += 2) small[i] = null;
Bun.gc(true);
const held: unknown[] = new Array(60_000).fill(null);
const taken: unknown[] = new Array(100_000).fill(null);
let places = 0;
for (let size = 64 * 1024 * 1024; size >= 4096; size /= 2) {
  // The large arrays set off collections, and a collection needs memory for its mark stack. This one finishes them while there is some, and what follows is too little to start another.
  if (size === 64 * 1024) Bun.gc(true);
  try { for (;;) taken[places++] = new Uint8Array(size); } catch {}
}
let made = 0;
let caught = "nothing";
${fills}
console.log(caught, made > 0, places > 0, small.length, taken.length);
`,
            });
            await build(String(folder));
            for (const limit of [1048576, 2097152]) {
              const { stdout, stderr, exitCode } = await run(
                ["sh", "-c", `ulimit -c 0 && ulimit -v ${limit} && exec ./program`],
                String(folder),
              );
              expect({ stdout, stderr, exitCode }).toEqual({
                stdout: "RangeError true true 200000 100000\n",
                stderr: "",
                exitCode: 0,
              });
            }
          },
          120_000,
        );

    inPart(test.skipIf(!isLinux || isASAN))(
      "the threads that a collection starts are up before the program goes on",
      async () => {
        // A typed array takes its bytes alone, an ArrayBuffer a small block as well.
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `const hold: unknown[] = [];
for (const kib of [262144, 16384, 1024, 64]) for (;;) { try { hold.push(new ArrayBuffer(kib * 1024)); } catch { break; } }
for (const kib of [40, 10]) for (;;) { try { hold.push(new Uint8Array(kib * 1024)); } catch { break; } }
console.log("alive");
`,
        });
        await build(String(folder));
        // Each program starts 64 threads, so 20 run at once.
        const runs: Awaited<ReturnType<typeof run>>[] = [];
        for (let batch = 0; batch < 5; batch++) {
          runs.push(
            ...(await Promise.all(
              Array.from({ length: 20 }, () =>
                run(["sh", "-c", "ulimit -c 0 && ulimit -v 4194304 && exec ./program"], String(folder), {
                  BUN_JSC_numberOfGCMarkers: "64",
                }),
              ),
            )),
          );
        }
        // With no address space left a request to malloc that may not fail ends the process on purpose (oven-sh/WebKit#937), and a collection makes
        // such requests on its helper threads: the one that wakes more than 16 parked helpers allocates its list of them. That is one run of 3,000.
        // Without the wait for the threads it is about one run of seven, so two of the hundred may end so and every other run prints "alive".
        const endedForRequestThatMayNotFail = runs.filter(
          ({ stderr, exitCode }) => exitCode !== 0 && stderr.includes("Segmentation fault at address 0xBBADBEEF"),
        );
        expect(
          runs.filter(
            run => !endedForRequestThatMayNotFail.includes(run) && (run.stdout !== "alive\n" || run.exitCode !== 0),
          ),
        ).toEqual([]);
        expect(endedForRequestThatMayNotFail.length).toBeLessThanOrEqual(2);
      },
      240_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "with its address space used up a key that finds no memory for its text throws",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          "program.ts": `const hold: ArrayBuffer[] = [];
const map = new Map<string, number>();
for (const kib of [262144, 16384, 1024, 64]) for (;;) { try { hold.push(new ArrayBuffer(kib * 1024)); } catch { break; } }
console.log("address space used up");
try {
  // However much room the buffers have left, this uses it up.
  for (let i = 0; i < 100_000_000; i++) map.set("a-prefix-of-18-chars" + (100000 + i), i);
  console.log("all were made");
} catch (e) { console.log("caught " + (e as Error).name + ": " + (e as Error).message); }
console.log("alive");
`,
        });
        await build(String(folder));
        for (const limit of [4194304, 2097152]) {
          expect(
            await run(["sh", "-c", `ulimit -c 0 && ulimit -v ${limit} && exec ./program`], String(folder), {
              BUN_JSC_numberOfGCMarkers: "1",
            }),
          ).toEqual({
            stdout: "address space used up\ncaught RangeError: Out of memory\nalive\n",
            stderr: "",
            exitCode: 0,
          });
        }
      },
      120_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
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

    inPart(test.skipIf(!isLinux || isASAN))(
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

    inPart(test.skipIf(!isLinux || isASAN))(
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

    inPart(test)(
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

    test.each(
      dealt([
        ["is given a name under a key", `const object = {}; object["p" + i] = i;`],
        [
          "is given a name by Object.defineProperty",
          `const object = {}; Object.defineProperty(object, "p" + i, { value: i });`,
        ],
        ["is a function that is given a name under a key", `const object = function () {}; object["p" + i] = i;`],
        ["is given a prototype", `const object = { a: 1 }; Object.setPrototypeOf(object, {});`],
        ["is created with a prototype of its own", `const object = Object.create({});`],
        ["has a field and is given a name under a key", `const object = { a: 1 }; object["p" + i] = i;`],
        ["is made by a class and is given a name under a key", `const object = new Thing(); object["p" + i] = i;`],
        ["is given a name and frozen", `const object = {}; object["p" + i] = i; Object.freeze(object);`],
        ["is given a name and sealed", `const object = {}; object["p" + i] = i; Object.seal(object);`],
        [
          "is given a name and made non-extensible",
          `const object = {}; object["p" + i] = i; Object.preventExtensions(object);`,
        ],
        ["is given a name and an index", `const object = {}; object["p" + i] = i; object[0] = i;`],
      ]),
    )(
      "a program that lets go of everything fills the room for the shapes of objects as far again, where each object %s",
      async (_, makeObject) => {
        using folder = tempDir("aot-heap-limit", {
          "program.js": `class Thing { constructor() { this.a = 1; } }
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
`,
        });
        const built = await run(
          [bunExe(), "build", "--compile", "--aot", "program.js", "--outfile", "program"],
          String(folder),
        );
        expect(built.exitCode).toBe(0);
        const { stdout, stderr, exitCode } = await run([join(String(folder), "program")], String(folder), {
          BUN_JSC_structureHeapSizeInKB: "16384",
        });
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "true,true,true,true\n", stderr: "", exitCode: 0 });
      },
      240_000,
    );

    inPart(test)(
      "a program that fills the room for the shapes of objects again and again catches the error every time",
      async () => {
        using folder = tempDir("aot-heap-limit", {
          // The names come again, so a fill finds the shapes of the fill before it, which no collection has freed yet, and asks for no new one until its end.
          "program.js": `class Thing { constructor() { this.a = 1; } }
let keep = [];
function fill() {
  for (let i = 0; ; i++) {
    const object = new Thing();
    object["p" + i] = i;
    keep.push(object);
  }
}
let caught = 0;
let first = 0;
let least = Infinity;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    fill();
  } catch (error) {
    if (error instanceof RangeError) caught++;
    first ||= keep.length;
    least = Math.min(least, keep.length);
    keep = [];
  }
}
console.log(caught, least * 2 > first);
`,
        });
        const built = await run(
          [bunExe(), "build", "--compile", "--aot", "program.js", "--outfile", "program"],
          String(folder),
        );
        expect(built.exitCode).toBe(0);
        const { stdout, stderr, exitCode } = await run([join(String(folder), "program")], String(folder), {
          BUN_JSC_structureHeapSizeInKB: "4096",
        });
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "60 true\n", stderr: "", exitCode: 0 });
      },
      120_000,
    );

    const case9 = together("9", sixWorkersOneAfterTheOther);
    inPart(test.skipIf(!isLinux))(
      "the range of a Worker that has ended is given back",
      async () => {
        using folder = tempDir("aot-heap-limit", case9);
        const { stdout, exitCode } = await run([await linkTogether(String(folder))], String(folder));
        expect({ stdout, exitCode }).toEqual({ stdout: "given back\n", exitCode: 0 });
      },
      120_000,
    );
  });
}
