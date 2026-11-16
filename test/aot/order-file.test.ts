import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canTrim, model } from "../bundler/compile-trim-features";
import { isHardened } from "./hardened";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";
import { readRemovedFeatures, sayFeaturesAreRemoved } from "./trimmed-against-whole/removed-features";

const program = `import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { helper, unused } from "./helper";
const start = new Int32Array(isMainThread ? new SharedArrayBuffer(8) : workerData);
class Shape { constructor(public a: number) {} area() { return this.a * 2; } get twice() { return this.area() * 2; } }
class Round extends Shape { area() { return super.area() + helper(this.a); } }
function* steps(n: number) { for (let i = 0; i < n; i++) yield i; }
async function later(n: number) { await 0; return n + 1; }
async function work() {
  let total = 0;
  for (const value of steps(5)) total += new Round(value).twice + [3, 1].sort((a, b) => a - b).map(x => x + value)[0];
  try { JSON.parse("{"); } catch (error) { total += (error as Error).name.length; }
  return later(total);
}
if (isMainThread) {
  if (process.argv[2] === "never") setTimeout(unused);
  const count = 8;
  const url = new URL(import.meta.url);
  const workers = Array.from({ length: count }, () => new Worker(url, { workerData: start.buffer }));
  const results = workers.map(worker => new Promise<number>(resolve => worker.on("message", resolve)));
  while (Atomics.load(start, 1) < count) await Bun.sleep(1);
  Atomics.store(start, 0, 1);
  Atomics.notify(start, 0);
  console.log(new Set([...(await Promise.all(results)), await work()]).size, await work());
  await Promise.all(workers.map(worker => worker.terminate()));
} else {
  Atomics.add(start, 1, 1);
  Atomics.wait(start, 0, 0);
  parentPort!.postMessage(await work());
}
`;
const helper = `export function helper(n: number) { return n * 3 + 1; }
export function unused() { console.log("never"); return process.argv.length; }
`;

async function run(cmd: string[], env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, undefined, { ...bunEnv, ...env });
  return { stdout, stderr, exitCode };
}

const pathsOf = (directory: string, order: string) =>
  order
    .split(",")
    .map(name => join(directory, name))
    .join(",");

const buildCommand = (directory: string, outfile: string, order?: string, flags: string[] = []) => [
  bunExe(),
  "build",
  "--compile",
  "--aot",
  ...flags,
  ...(order === undefined ? [] : [`--aot-order=${pathsOf(directory, order)}`]),
  join(directory, "program.ts"),
  "--outfile",
  join(directory, outfile),
];

async function build(directory: string, outfile: string, order?: string, flags: string[] = []) {
  const built = await run(buildCommand(directory, outfile, order, flags));
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const warnings = built.stderr.split("\n").filter(line => line.includes("--aot-order"));
  return { executable: join(directory, outfile), warnings };
}

async function record(directory: string, name: string) {
  const { executable } = await build(directory, "recorder", undefined, ["--aot-record-order"]);
  const { exitCode, stderr } = await run([executable], { BUN_AOT_ORDER_OUT: join(directory, name) });
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  return readFileSync(join(directory, name), "utf8");
}

// Where a file was recorded doesn't matter: a test below builds in other folders.
let recording: Promise<string> | undefined;
const recordingOfProgram = () =>
  (recording ??= (async () => {
    using dir = tempDir("aot-order-file-recording", { "program.ts": program, "helper.ts": helper });
    return await record(String(dir), "recorded");
  })());

const bytesOf = (path: string) => Bun.hash(readFileSync(path)).toString(16);

function codeOfStart(path: string) {
  const file = readFileSync(path);
  const image = file.lastIndexOf("BUNAOT01");
  return { size: file.readUInt32LE(image + 76), executableSize: Number(file.readBigUInt64LE(image + 64)) };
}

const isSupported = isLinux && !isHardened;
const recorder = model.features.find(({ name }) => name === "OrderRecorder")!.index;

test.skipIf(!isSupported)(
  "a run writes the order in which it entered the functions, and a build places the code by it",
  async () => {
    using dir = tempDir("aot-order-file", { "program.ts": program, "helper.ts": helper });
    const { executable } = await build(String(dir), "program");
    const expected = await run([executable]);
    expect(expected).toEqual({ stdout: expect.stringMatching(/^1 \d+\n$/), stderr: "", exitCode: 0 });

    const order = join(String(dir), "recorded");
    expect(await run([executable], { BUN_AOT_ORDER_OUT: order })).toEqual(expected);
    expect(existsSync(order)).toBe(false);
    const recorded = await recordingOfProgram();
    writeFileSync(order, recorded);
    const lines = recorded.split("\n");
    expect(lines[0]).toBe("aot-order v1");
    expect(lines.at(-1)).toBe("");
    const names = lines.filter(line => line.startsWith("F ")).map(line => line.split(" ").at(-1));
    expect(names).toContain("work");
    expect(names).not.toContain("unused");
    expect(lines.filter(line => line.startsWith("M ") && line.endsWith("program.ts"))).toHaveLength(1);

    const unordered = bytesOf(executable);
    const ordered = await build(String(dir), "program", "recorded");
    expect(ordered.warnings).toEqual([]);
    expect(await run([ordered.executable])).toEqual(expected);
    const start = codeOfStart(ordered.executable);
    expect(start.size).toBeGreaterThan(0);
    expect(start.size).toBeLessThan(start.executableSize);
    const bytes = bytesOf(ordered.executable);
    expect(bytes).not.toBe(unordered);
    expect(bytesOf((await build(String(dir), "program", "recorded")).executable)).toBe(bytes);
    expect(bytesOf((await build(String(dir), "program")).executable)).toBe(unordered);
  },
  240_000,
);

test.skipIf(!isSupported)(
  "a torn file, a file of another program and garbage place what they name and break nothing",
  async () => {
    using dir = tempDir("aot-order-file-garbage", { "program.ts": program, "helper.ts": helper });
    const { executable } = await build(String(dir), "program");
    const expected = await run([executable]);
    const unordered = bytesOf(executable);
    const recorded = await recordingOfProgram();
    const files = {
      torn: recorded.slice(0, recorded.length * 0.6),
      foreign: "aot-order v1\nM 0 nothing.ts\nF 0 0 b0 - 1:1 \nF 0 999999999 e7 - 1:1 work\nF 5 0 b0 - 1:1 work\n",
      broken: recorded.replaceAll(" b0 ", " q0 ") + "F\nF 0\nM x y\n\0\xff",
      empty: "",
      blanks: recorded.replaceAll("\n", " \n"),
      garbage: "\0\xff".repeat(1000),
    };
    for (const [name, text] of Object.entries(files)) writeFileSync(join(String(dir), name + ".order"), text, "latin1");
    for (const name of ["torn", "broken", "foreign", "empty.order,blanks.order,garbage"]) {
      const built = await build(String(dir), "program", name + ".order");
      expect({ name, ...(await run([built.executable])) }).toEqual({ name, ...expected });
      const namesNothing = name !== "torn" && name !== "broken";
      const warnings = namesNothing ? name.split(",").length : 0;
      expect({ name, warnings: built.warnings.length }).toEqual({ name, warnings });
      if (namesNothing) expect({ name, bytes: bytesOf(built.executable) }).toEqual({ name, bytes: unordered });
    }
    const missing = await run(buildCommand(String(dir), "missing", "torn.order,no-such-file.order"));
    expect(missing.stderr).toContain("no-such-file.order cannot be read");
    expect(missing.exitCode).toBe(1);
    expect(existsSync(join(String(dir), "missing"))).toBe(false);
  },
  600_000,
);

test.skipIf(!isSupported)(
  "a file that an editor or a checkout rewrote places what the recorded file places",
  async () => {
    using dir = tempDir("aot-order-file-rewritten", { "program.ts": program, "helper.ts": helper });
    const recorded = await recordingOfProgram();
    writeFileSync(join(String(dir), "recorded"), recorded);
    const placed = bytesOf((await build(String(dir), "program", "recorded")).executable);
    writeFileSync(join(String(dir), "rewritten"), "\ufeff# of one start\r\n\r\n" + recorded.replaceAll("\n", "\r\n"));
    const { executable, warnings } = await build(String(dir), "program", "rewritten");
    expect({ bytes: bytesOf(executable), warnings }).toEqual({ bytes: placed, warnings: [] });
  },
  240_000,
);

test.skipIf(!isSupported)(
  "the recorder leaves a killed process's file, listeners for SIGTRAP and a missing folder alone",
  async () => {
    const source = `process.on("SIGTRAP", () => {});
function first(n: number): number { return n ? first(n - 1) + first(n - 1) : 1; }
console.log(first(3));
if (process.argv[2] === "stay") setInterval(() => {}, 1000);
`;
    using dir = tempDir("aot-order-file-signals", { "program.ts": source });
    const { executable } = await build(String(dir), "program", undefined, ["--aot-record-order"]);
    const order = join(String(dir), "recorded");
    expect(await run([executable], { BUN_AOT_ORDER_OUT: order })).toEqual({ stdout: "8\n", stderr: "", exitCode: 0 });
    await using stays = Bun.spawn([executable, "stay"], {
      env: { ...bunEnv, BUN_AOT_ORDER_OUT: order + ".%p" },
      stdout: "pipe",
      stderr: "inherit",
    });
    const written = `${order}.${stays.pid}`;
    const listsFirst = () => existsSync(written) && readFileSync(written, "utf8").includes(" first\n");
    for (const end = Date.now() + 120_000; !listsFirst() && stays.exitCode === null && Date.now() < end;)
      await Bun.sleep(10);
    expect({ listsFirst: listsFirst(), exitCode: stays.exitCode }).toEqual({ listsFirst: true, exitCode: null });
    stays.kill("SIGKILL");
    expect(await stays.stdout.text()).toBe("8\n");
    await stays.exited;
    expect(readFileSync(written, "utf8")).toContain(" first\n");
    const missing = await run([executable], { BUN_AOT_ORDER_OUT: join(String(dir), "missing", "file") });
    expect(missing).toEqual({ stdout: "8\n", stderr: expect.stringContaining("nothing is recorded"), exitCode: 0 });
  },
  240_000,
);

test.skipIf(!isSupported)(
  "a file of an older build places what is still there",
  async () => {
    using dir = tempDir("aot-order-file-stale", { "program.ts": program, "helper.ts": helper });
    writeFileSync(join(String(dir), "recorded"), await recordingOfProgram());

    writeFileSync(
      join(String(dir), "helper.ts"),
      `const added = (n: number) => n;
export function inFront(n: number) { return added(n) + 1; }
export function helper(n: number) { return inFront(n * 3); }
export function unused() { console.log("never"); }
`,
    );
    writeFileSync(join(String(dir), "program.ts"), "// A line in front.\n" + program.replaceAll("twice", "doubled"));
    const { executable } = await build(String(dir), "program");
    const expected = await run([executable]);
    expect(expected).toEqual({ stdout: expect.stringMatching(/^1 \d+\n$/), stderr: "", exitCode: 0 });
    const unordered = bytesOf(executable);
    const ordered = await build(String(dir), "program", "recorded");
    expect(ordered.warnings).toEqual([]);
    expect(await run([ordered.executable])).toEqual(expected);
    expect(bytesOf(ordered.executable)).not.toBe(unordered);
  },
  240_000,
);

test.skipIf(!isSupported)(
  "a file that a build in another folder recorded places what a file of this folder places",
  async () => {
    using dir = tempDir("aot-order-file-folders", {
      "packages/app/program.ts": program.replace("./helper", "../shared/helper"),
      "packages/shared/helper.ts": helper,
    });
    const path = (name: string) => join(String(dir), name);
    const executable = path("program");
    const entries: Record<string, string> = {
      "packages/app": "./program.ts",
      "packages": "./app/program.ts",
      ".": "./packages/app/program.ts",
    };
    const buildIn = async (folder: string, ...flags: string[]) => {
      const command = [bunExe(), "build", "--compile", "--aot", ...flags, entries[folder], "--outfile", executable];
      const { stderr, exitCode } = await runCommand(command, path(folder), bunEnv);
      expect({ stderr, exitCode }).toEqual({ stderr: expect.not.stringContaining("--aot-order"), exitCode: 0 });
    };
    const sizes: number[] = [];
    for (const [recordedIn, folders] of [
      ["packages/app", Object.keys(entries)],
      [".", ["packages/app"]],
    ] as const) {
      await buildIn(recordedIn, "--aot-record-order");
      expect((await run([executable], { BUN_AOT_ORDER_OUT: path("recorded") })).exitCode).toBe(0);
      for (const folder of folders) {
        await buildIn(folder, `--aot-order=${path("recorded")}`);
        sizes.push(codeOfStart(executable).size);
      }
    }
    expect(sizes[0]).toBeGreaterThan(0);
    expect(sizes).toEqual(sizes.map(() => sizes[0]));
  },
  300_000,
);

test.skipIf(!isSupported)(
  "files that were moved or renamed since the recording are found by their functions",
  async () => {
    const functions = (prefix: string) =>
      Array.from(
        { length: 8 },
        (_, i) => `export function ${prefix}${i}(n: number): number {
  let sum = ${i};
  for (let k = 0; k < n; k++) sum = (sum * 31 + k * ${i + 3}) % 1000003;
  return sum;
}
`,
      ).join("");
    const table = (namespace: string, prefix: string) =>
      `[${Array.from({ length: 8 }, (_, i) => `${namespace}.${prefix}${i}`)}]`;
    const cold = functions("other");
    const setup =
      "globalThis.started = process.argv.length;\nexport function later(n: number): number { return n ? later(n - 1) + 1 : 0; }\n";
    const main = (places: Record<string, string>, setup: string) => `${Object.entries(places)
      .map(([name, place]) => `import * as ${name} from "${place}";\n`)
      .join("")}import { later } from "${setup}";
import * as cold from "./cold";
if (process.argv[2] === "never") console.log(later(process.argv.length));
const table = process.argv[2] === "never" ? ${table("cold", "other")} : [${Object.keys(places)
      .map(name => table(name, name))
      .join(", ")}].flat();
let sum = 0;
for (let i = 0; i < table.length; i++) sum += table[i]!(process.argv.length + i);
console.log(sum);
`;
    // Where the functions of that name lay, and where they lie now.
    const places = {
      moved: ["./lib/moved", "./moved"],
      renamed: ["./lib/renamed", "./lib/all"],
      movedAndRenamed: ["./lib/movedAndRenamed", "./src/deep/both"],
      movedAndEdited: ["./lib/movedAndEdited", "./src/movedAndEdited"],
      behindBarrel: ["./lib/behindBarrel", "./lib/behindBarrel"],
    };
    const placesAt = (index: number) =>
      Object.fromEntries(Object.entries(places).map(([name, at]) => [name, at[index]]));
    const filesAt = (index: number) =>
      Object.fromEntries(Object.entries(places).map(([name, at]) => [at[index].slice(2) + ".ts", functions(name)]));
    const now: Record<string, string> = {
      ...filesAt(1),
      "program.ts": main(placesAt(1), "./prepare"),
      "cold.ts": cold,
    };
    now["src/movedAndEdited.ts"] =
      "\nexport function added(n: number) {\n  return n + 1;\n}\n" + now["src/movedAndEdited.ts"];
    now["lib/behind.ts"] = now["lib/behindBarrel.ts"];
    now["lib/behindBarrel.ts"] = 'export * from "./behind";\n';
    // Of this file the module's body alone is recorded.
    now["prepare.ts"] = setup;
    const recorded = { ...filesAt(0), "program.ts": main(placesAt(0), "./setup"), "setup.ts": setup, "cold.ts": cold };
    using dir = tempDir("aot-order-file-moved", recorded);
    using changed = tempDir("aot-order-file-moved-now", now);
    writeFileSync(join(String(changed), "before"), await record(String(dir), "recorded"));
    const names = new Set((await record(String(changed), "after")).split("\n").map(line => line.split(" ").at(-1)!));
    const before = codeOfStart((await build(String(changed), "program", "before")).executable).size;
    const after = codeOfStart((await build(String(changed), "program", "after")).executable).size;
    const found = Object.keys(places).map(name => [name, [...names].filter(each => each.slice(0, -1) === name).length]);
    expect({ found, before }).toEqual({ found: Object.keys(places).map(name => [name, 8]), before: after });
  },
  300_000,
);

test.skipIf(!isSupported)(
  "compile.aotOrder of Bun.build writes the same bytes as --aot-order",
  async () => {
    using dir = tempDir("aot-order-file-api", {
      "program.ts": program,
      "helper.ts": helper,
      "build.ts": `const [entry, outfile, ...names] = process.argv.slice(2);
const aotOrder = names.length > 1 ? names : (names[0] ?? false);
const { success } = await Bun.build({ entrypoints: [entry], compile: { aot: true, outfile, aotOrder } });
if (!success) process.exit(1);
`,
    });
    const { executable } = await build(String(dir), "program");
    const unordered = bytesOf(executable);
    const order = join(String(dir), "recorded, by a start");
    writeFileSync(order, await recordingOfProgram());
    writeFileSync(join(String(dir), "recorded"), await recordingOfProgram());
    const bytes = bytesOf((await build(String(dir), "program", "recorded")).executable);
    const script = join(String(dir), "build.ts");
    const buildByApi = async (...aotOrder: string[]) => {
      const built = await run([bunExe(), script, join(String(dir), "program.ts"), executable, ...aotOrder]);
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
      return bytesOf(executable);
    };
    // The flag alone is split at commas.
    expect(await buildByApi(order)).toBe(bytes);
    expect(await buildByApi()).toBe(unordered);
    // An empty name is no file, as it is for the flag.
    expect(await buildByApi("")).toBe(unordered);
    expect(await buildByApi("", order)).toBe(bytes);
  },
  240_000,
);

test.skipIf(!isSupported)(
  "several files are joined, and the first that lists a function places it",
  async () => {
    using dir = tempDir("aot-order-file-joined", { "program.ts": program, "helper.ts": helper });
    const { executable } = await build(String(dir), "recorder", undefined, ["--aot-record-order"]);
    const record = async (name: string, ...args: string[]) =>
      expect((await run([executable, ...args], { BUN_AOT_ORDER_OUT: join(String(dir), name) })).exitCode).toBe(0);
    await record("a.order");
    await record("b.order", "never");
    const start = async (order: string) => codeOfStart((await build(String(dir), "program", order)).executable).size;
    const a = await start("a.order");
    const joined = await start("a.order,b.order");
    expect(joined).toBeGreaterThan(a);
    expect(await start("b.order,a.order")).toBe(joined);
    const repeated = ["a.order", "b.order"].map(name => `--aot-order=${join(String(dir), name)}`);
    const twice = await build(String(dir), "program", undefined, repeated);
    expect(codeOfStart(twice.executable).size).toBe(joined);
    const alone = bytesOf((await build(String(dir), "program", "a.order")).executable);
    expect(bytesOf((await build(String(dir), "program", "a.order,a.order")).executable)).toBe(alone);
  },
  300_000,
);

test.skipIf(!isSupported)(
  "a build that differs in a stamp alone finds every line",
  async () => {
    const stamped = (stamp: string) =>
      `const stamp = "${stamp}";\nif (process.argv[3]) console.log(stamp);\n${program}`;
    using dir = tempDir("aot-order-file-stamp", { "program.ts": stamped("1f0c2a9e"), "helper.ts": helper });
    await record(String(dir), "first");
    writeFileSync(join(String(dir), "program.ts"), stamped("c4b07d3158"));
    await record(String(dir), "second");
    const placedByFirst = codeOfStart((await build(String(dir), "program", "first")).executable).size;
    const placedBySecond = codeOfStart((await build(String(dir), "program", "second")).executable).size;
    expect(placedByFirst).toBe(placedBySecond);
    const linesOf = (name: string) =>
      readFileSync(join(String(dir), name), "utf8")
        .split("\n")
        .filter(line => line.startsWith("F "));
    expect(linesOf("first").length).toBe(linesOf("second").length);
  },
  300_000,
);

test.skipIf(!isSupported)(
  "what the plain build recorded places the code of a build with --obfuscate",
  async () => {
    using dir = tempDir("aot-order-file-obfuscated", { "program.ts": program, "helper.ts": helper });
    const expected = await run([(await build(String(dir), "program")).executable]);
    await record(String(dir), "recorded");
    const flags = ["--obfuscate", "--sourcemap=external"];
    const plain = await build(String(dir), "program", "recorded", flags);
    expect(await run([plain.executable])).toEqual(expected);
    expect(codeOfStart(plain.executable).size).toBeGreaterThan(0);
  },
  300_000,
);

test.skipIf(!isSupported)(
  "compile.aotRecordOrder of Bun.build builds an executable that records, as --aot-record-order",
  async () => {
    using dir = tempDir("aot-order-file-record-api", {
      "program.ts": program,
      "helper.ts": helper,
      "build.ts": `const [entry, outfile] = process.argv.slice(2);
const { success } = await Bun.build({ entrypoints: [entry], compile: { aot: true, outfile, aotRecordOrder: true } });
if (!success) process.exit(1);
`,
    });
    const outfile = join(String(dir), "program");
    const built = await run([bunExe(), join(String(dir), "build.ts"), join(String(dir), "program.ts"), outfile]);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    const order = join(String(dir), "recorded");
    expect((await run([outfile], { BUN_AOT_ORDER_OUT: order })).exitCode).toBe(0);
    expect(readFileSync(order, "utf8")).toStartWith("aot-order v1\n");
  },
  300_000,
);

test.skipIf(!isSupported)(
  "an executable without --aot-record-order never enters the recorder",
  async () => {
    using dir = tempDir("aot-order-file-no-recorder", { "program.ts": "console.log([3, 1, 2].sort().join());\n" });
    const { executable } = await build(String(dir), "program");
    sayFeaturesAreRemoved(executable, [recorder]);
    expect(await run([executable], { BUN_AOT_ORDER_OUT: join(String(dir), "recorded") })).toEqual({
      stdout: "1,2,3\n",
      stderr: "",
      exitCode: 0,
    });
  },
  120_000,
);

test.skipIf(!isSupported || !canTrim)(
  "a trimmed executable without --aot-record-order has no recorder",
  async () => {
    using dir = tempDir("aot-order-file-trimmed", { "program.ts": "console.log([3, 1, 2].sort().join());\n" });
    const order = join(String(dir), "recorded");
    const plain = await build(String(dir), "plain", undefined, ["--trim"]);
    const recording = await build(String(dir), "recording", undefined, ["--trim", "--aot-record-order"]);
    expect(await run([plain.executable], { BUN_AOT_ORDER_OUT: order })).toEqual({
      stdout: "1,2,3\n",
      stderr: "",
      exitCode: 0,
    });
    expect(existsSync(order)).toBe(false);
    expect((await run([recording.executable], { BUN_AOT_ORDER_OUT: order })).exitCode).toBe(0);
    expect(readFileSync(order, "utf8")).toStartWith("aot-order v1\n");
    expect(readRemovedFeatures(plain.executable)).toContain(recorder);
    expect(readRemovedFeatures(recording.executable)).not.toContain(recorder);
  },
  300_000,
);
