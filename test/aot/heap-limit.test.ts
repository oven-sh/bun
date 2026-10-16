import { expect } from "bun:test";
import { describe, test } from "./supported";
import { bunEnv, bunExe, isASAN, isLinux, isWindows, tempDir } from "harness";
import { join } from "node:path";

// An ahead-of-time compiled program keeps most references between objects in 32 bits, so its objects live in one reserved range of
// address space. Each Worker has a range of its own. These tests shrink the ranges to see what happens at their end.

const smallHeap = { BUN_JSC_markedBlockCageSizeInMB: "64" };

const keepsEverything = `type Entry = { id: number; next: Entry | null };
let head: Entry | null = null;
for (let i = 0; i < 4_000_000; i++) head = { id: i, next: head };
console.log("never full", head!.id);
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
for (let tries = 0; tries < 100 && grown >= oneRangeInKB; tries++) {
  await Bun.sleep(50);
  grown = addressSpaceInKB() - before;
}
console.log(grown < oneRangeInKB ? "given back" : "kept " + grown + " KB");
`,
  "worker.ts": `import { parentPort } from "node:worker_threads";
parentPort!.postMessage("done");
`,
};

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({ cmd, cwd, env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function build(cwd: string, ...moreEntryPoints: string[]) {
  const built = await run([bunExe(), "build", "--compile", "--aot", "program.ts", ...moreEntryPoints, "--outfile", "program"], cwd);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
  return join(cwd, "program");
}

if (isASAN) console.error("SKIPPED: the tests of heap-limit.test.ts under `ulimit -v`: a program built with AddressSanitizer does not start there");

describe.skipIf(isWindows).concurrent("the address space for objects of a compiled program", () => {
  test("a program that keeps more objects alive than fit stops and says why", async () => {
    using folder = tempDir("aot-heap-limit", { "program.ts": keepsEverything });
    const program = await build(String(folder));
    const { stdout, stderr, exitCode } = await run([program], String(folder), smallHeap);
    expect(stderr).toContain("FATAL: MarkedBlocks fill the 64 MB of address space");
    expect(stderr).toMatch(/Bun (has run|ran) out of memory/);
    expect(stderr).not.toContain("This indicates a bug in Bun");
    expect(stdout).not.toContain("never full");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test("the same program runs to its end in the default range", async () => {
    using folder = tempDir("aot-heap-limit", { "program.ts": keepsEverything });
    const { stdout, exitCode } = await run([await build(String(folder))], String(folder));
    expect({ stdout, exitCode }).toEqual({ stdout: "never full 3999999\n", exitCode: 0 });
  }, 120_000);

  test("garbage does not fill it", async () => {
    using folder = tempDir("aot-heap-limit", { "program.ts": keepsLittle });
    const { stdout, exitCode } = await run([await build(String(folder))], String(folder), smallHeap);
    expect({ stdout, exitCode }).toEqual({ stdout: "done 15999999\n", exitCode: 0 });
  }, 120_000);

  test("two Workers each keep more alive than half a range holds", async () => {
    using folder = tempDir("aot-heap-limit", twoWorkersThatKeepMoreThanHalfARange);
    const program = await build(String(folder), "worker.ts");
    const { stdout, stderr, exitCode } = await run([program], String(folder), { BUN_JSC_markedBlockCageSizeInMB: "128" });
    expect(stderr).not.toContain("FATAL");
    expect({ stdout, exitCode }).toEqual({ stdout: "3002300000,3002300000 2000000000\n", exitCode: 0 });
  }, 120_000);

  test.skipIf(!isLinux || isASAN)("where address space is limited a Worker shares the range of the main thread", async () => {
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
  }, 120_000);

  test.skipIf(!isLinux || isASAN)("where address space is limited much of it is left for Workers and their threads", async () => {
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
    const { stdout, stderr, exitCode } = await run(["sh", "-c", "ulimit -v 8388608 && exec ./program"], String(folder));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "roomy 4999950000,4999950000,4999950000,4999950000\n", stderr: "", exitCode: 0 });
  }, 120_000);

  test.skipIf(!isLinux)("the range of a Worker that has ended is given back", async () => {
    using folder = tempDir("aot-heap-limit", sixWorkersOneAfterTheOther);
    const { stdout, exitCode } = await run([await build(String(folder), "worker.ts")], String(folder));
    expect({ stdout, exitCode }).toEqual({ stdout: "given back\n", exitCode: 0 });
  }, 120_000);
});
