// In the CPU profile of a compiled executable a compiled function has what every other function has: a file:// URL, the line of its
// definition and sampled lines, all in the original source.
// Runs alone: it counts the samples that a timer takes.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";
import { cCompiler, without } from "./harness/capabilities";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

const source = `const deadline = Date.now() + 300;
let total = 0;
function hot(n: number): number {
  const squares = new Map<number, number[]>();
  for (let i = 0; i < n; i++) squares.set(i, [i, i * i]);
  let sum = 0;
  for (const [, pair] of squares) sum += pair[1] % 7;
  return sum;
}
while (Date.now() < deadline) total += hot(10_000);
console.log(total > 0);
`;
const lines = source.split("\n");
const definitionLine = lines.indexOf("function hot(n: number): number {");
const lastLine = lines.indexOf("}", definitionLine);

type ProfileNode = {
  id: number;
  children?: number[];
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount: number;
  positionTicks?: { line: number; ticks: number }[];
};

function readNodes(file: string): ProfileNode[] {
  return JSON.parse(readFileSync(file, "utf8")).nodes;
}
async function buildProgramThatProfilesItself(cwd: string) {
  const profilerFlags = "--compile-exec-argv=--cpu-prof --cpu-prof-name=own.cpuprofile";
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", profilerFlags, "main.ts", "--outfile", "program"],
      cwd,
      bunEnv,
    ),
  );
}
function hitCountsByCall(nodes: ProfileNode[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const hits: Record<string, number> = {};
  for (const caller of nodes) {
    for (const callee of (caller.children ?? []).map(id => byId.get(id)!)) {
      const call = `${caller.callFrame.functionName} > ${callee.callFrame.functionName}`;
      hits[call] = (hits[call] ?? 0) + callee.hitCount;
    }
  }
  return hits;
}
function expectSamplesIn(calls: string[], nodes: ProfileNode[]) {
  const {
    "(root) > (program)": _program,
    "(root) > (garbage collector)": _collector,
    ...hits
  } = hitCountsByCall(nodes);
  const total = Object.values(hits).reduce((sum, count) => sum + count);
  const inCalls = calls.reduce((sum, call) => sum + (hits[call] ?? 0), 0);
  expect(hits).toSatisfy(() => inCalls > total * 0.7 && calls.every(call => hits[call] > total / 50));
}
const isHot = (node: ProfileNode) => node.callFrame.functionName === "hot";
const definitionLines = (nodes: ProfileNode[]) => [...new Set(nodes.map(node => node.callFrame.lineNumber))];

test("a compiled function in a CPU profile", async () => {
  using dir = tempDir("aot-cpu-profile-urls", { "main.ts": source });
  const cwd = String(dir);
  // With both formats the name gets each format's extension.
  const profilerFlags = "--cpu-prof --cpu-prof-md --cpu-prof-dir=profiles --cpu-prof-name=own";
  built(
    await spawned(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        `--compile-exec-argv=${profilerFlags}`,
        "main.ts",
        "--outfile",
        "program",
      ],
      cwd,
      bunEnv,
    ),
  );
  const compiled = await spawned([join(cwd, "program")], cwd, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });

  const nodes = readNodes(join(cwd, "profiles", "own.cpuprofile"));
  const hot = nodes.filter(isHot);
  expect(definitionLines(hot)).toEqual([definitionLine]);
  for (const node of hot) expect(node.callFrame.url).toMatch(/^file:\/\/.*\/main\.ts$/);

  // positionTicks has one-based lines.
  const sampledLines = hot.flatMap(node => node.positionTicks ?? []).map(tick => tick.line);
  expect(sampledLines.filter(line => line <= definitionLine || line > lastLine + 1)).toEqual([]);
  // Only a sample taken while hot() calls into the runtime has a position. Windows' timer resolution allows about 20 samples in 300 ms: too few to guarantee one.
  if (!isWindows) expect(sampledLines).not.toBeEmpty();

  expect(nodes.map(node => node.callFrame.url).filter(url => /^([A-Za-z]:|\/|\\\\)/.test(url))).toEqual([]);

  // The markdown profile shows a path, not a URL, and a one-based line.
  const markdown = readFileSync(join(cwd, "profiles", "own.md"), "utf8");
  const hotLocations = Array.from(markdown.matchAll(/\| `hot` \| `(.*)` \|$/gm), match => match[1]);
  expect(hotLocations).not.toBeEmpty();
  const isInsideHot = (location: string) => {
    const line = Number(/^(?!file:).*[\\/]main\.ts:(\d+)$/.exec(location)?.[1]);
    return line > definitionLine && line <= lastLine + 1;
  };
  expect(hotLocations.filter(location => !isInsideHot(location))).toEqual([]);

  const plain = await spawned(
    [bunExe(), "--cpu-prof", "--cpu-prof-dir=profiles", "--cpu-prof-name=plain.cpuprofile", "main.ts"],
    cwd,
    bunEnv,
  );
  expect(plain.exitCode).toBe(0);
  expect(definitionLines(readNodes(join(cwd, "profiles", "plain.cpuprofile")).filter(isHot))).toEqual([definitionLine]);
}, 120_000);

// Compiled code runs one job after another without returning to the code that entered it.
test("a job that returns before its stack is read belongs to its own function", async () => {
  using dir = tempDir("aot-cpu-profile-jobs", {
    "main.ts": `
      let calls = 0;
      function busy(): void {
        calls++;
        for (const end = performance.now() + 60; performance.now() < end; );
      }
      async function firstAsync(): Promise<void> { await 0; busy(); }
      async function secondAsync(): Promise<void> { await 0; busy(); }
      function handler(): void { busy(); }
      function firstOfChain(): void { busy(); }
      function secondOfChain(): void { busy(); }
      function microtask(): void { busy(); }
      async function* generator(): AsyncGenerator<number> { await 0; busy(); yield 1; busy(); }
      async function consumer(): Promise<void> { for await (const _ of generator()) busy(); }
      function timer(): void {
        busy();
        firstAsync();
        secondAsync();
        Promise.resolve().then(handler);
        Promise.resolve().then(firstOfChain).then(secondOfChain);
        queueMicrotask(microtask);
        consumer();
      }
      setTimeout(timer, 1);
      process.on("exit", () => console.log(calls));`,
  });
  const cwd = String(dir);
  await buildProgramThatProfilesItself(cwd);
  const run = await spawned([join(cwd, "program")], cwd, {
    ...bunEnv,
    BUN_JSC_forceSamplingProfilerToMissStacks: "1",
  });
  expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({ stdout: "10\n", exitCode: 0 });

  const names = readNodes(join(cwd, "own.cpuprofile"))
    .filter(node => node.callFrame.url.endsWith("/main.ts"))
    .map(node => node.callFrame.functionName);
  expect(names).toEqual(
    expect.arrayContaining([
      "timer",
      "firstAsync",
      "secondAsync",
      "handler",
      "firstOfChain",
      "secondOfChain",
      "microtask",
      "generator",
      "consumer",
    ]),
  );
  expect(names).not.toContain("busy");
}, 120_000);

test("a native function has a frame of its own", async () => {
  using dir = tempDir("aot-cpu-profile-native-functions", {
    "main.ts": `
      import { statSync } from "node:fs";
      const list = Array.from({ length: 1000 }, (_, id) => ({ id }));
      const text = JSON.stringify(list);
      const table: any = {
        clone: structuredClone,
        reviver(_key: string, value: unknown) { structuredClone(value); return value; },
        get other() { return 1; },
      };
      const key = (name: string) => (process.argv.length > 50 ? "" : name);
      function clones(): number { return structuredClone(list).length; }
      function clonesByValue(): number { return table[key("clone")](list).length; }
      function stats(): number { return statSync(process.execPath).size; }
      function constructs(): number { return new URL("https://example.com/" + text).pathname.length; }
      function revives(): number { return JSON.parse(text, table[key("reviver")]).length; }
      let total = 0;
      for (const step of [clones, clonesByValue, stats, constructs, revives])
        for (const end = Date.now() + 200; Date.now() < end; ) total += step();
      console.log(total > 0);`,
  });
  const cwd = String(dir);
  await buildProgramThatProfilesItself(cwd);
  const run = await spawned([join(cwd, "program")], cwd, bunEnv);
  expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });

  expect(Object.keys(hitCountsByCall(readNodes(join(cwd, "own.cpuprofile"))))).toEqual(
    expect.arrayContaining([
      "clones > structuredClone",
      "clonesByValue > structuredClone",
      "stats > statSync",
      "constructs > URL",
      "revives > parse",
      "parse > reviver",
      "reviver > structuredClone",
    ]),
  );
}, 120_000);

test("what the runtime does for a function without a frame of its own belongs to that function", async () => {
  using dir = tempDir("aot-cpu-profile-helpers", {
    "main.ts": `
      const flat = (text: string) => Buffer.from(text, "latin1").toString("latin1");
      const long = Buffer.alloc(20_000, "a").toString("latin1");
      const text = flat(long + "b");
      const names = Array.from({ length: 500 }, (_, id) => ({ name: flat("n" + (10_000 + id)) }));
      const table: any = {
        text,
        same: flat(long + "b"),
        other: flat(long + "c"),
        isLast(item: any) { return item.name === "n10499"; },
        get getter() { return text.indexOf(key("b")); },
      };
      const key = (name: string) => (process.argv.length > 50 ? "" : name);
      function finds(): number { let sum = 0; for (let i = 0; i < 100; i++) sum += text.indexOf(key("b")); return sum; }
      function equals(): number { let sum = 0; const a = table[key("text")], b = table[key("same")]; for (let i = 0; i < 100; i++) sum += +(a === b); return sum; }
      function compares(): number { let sum = 0; const a = table[key("text")], b = table[key("other")]; for (let i = 0; i < 100; i++) sum += +(a < b); return sum; }
      function getters(): number { let sum = 0; for (let i = 0; i < 100; i++) sum += table[key("getter")]; return sum; }
      function literals(): number { let sum = 0; const isLast = table[key("isLast")]; for (const item of names) sum += +isLast(item); return sum; }
      function adds(): number {
        let sum = 0;
        for (let i = 0; i < 10; i++) {
          table.add = function add() { return i + sum; };
          for (let calls = 0; calls < 300; calls++) sum += table[key("add")]() & 1;
        }
        return sum;
      }
      let total = 0;
      for (const step of [finds, equals, compares, getters, literals, adds])
        for (const end = Date.now() + 200; Date.now() < end; ) total += step();
      console.log(total > 0);`,
  });
  const cwd = String(dir);
  await buildProgramThatProfilesItself(cwd);
  const run = await spawned([join(cwd, "program")], cwd, bunEnv);
  expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });

  expectSamplesIn(
    [
      "(module) > finds",
      "(module) > equals",
      "(module) > compares",
      "getters > getter",
      "literals > isLast",
      "(module) > adds",
      "adds > add",
    ],
    readNodes(join(cwd, "own.cpuprofile")),
  );
}, 120_000);

test("a slow allocation and the capture of a stack belong to the function that asked for them", async () => {
  using dir = tempDir("aot-cpu-profile-slow-paths", {
    "main.ts": `
      const key = (name: string) => (process.argv.length > 50 ? "" : name);
      const table: any = {
        Base: class Base { x: number; constructor(x: number) { this.x = x; } },
        below(depth: number): number { return depth ? table[key("below")](depth - 1) + 1 : errors(); },
      };
      function heirs(): number { let sum = 0; for (let i = 0; i < 100; i++) sum += Reflect.construct(table[key("Base")], [i], function () {}).x; return sum; }
      function errors(): number { let sum = 0; for (let i = 0; i < 100; i++) sum += new Error("").message.length; return sum; }
      function captures(): number { return table[key("below")](200) + 1; }
      Error.stackTraceLimit = 200;
      let total = 0;
      for (const step of [heirs, captures])
        for (let end = Date.now() + 400, rounds = 0; Date.now() < end || rounds < 30; rounds++) total += step();
      console.log(total > 0);`,
  });
  const cwd = String(dir);
  await buildProgramThatProfilesItself(cwd);
  const run = await spawned([join(cwd, "program")], cwd, bunEnv);
  expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });

  expectSamplesIn(["heirs > Base", "below > errors"], readNodes(join(cwd, "own.cpuprofile")));
}, 120_000);

test("a function is below the function that called it", async () => {
  using dir = tempDir("aot-cpu-profile-callers", {
    "main.ts": `
      const key = (name: string) => (process.argv.length > 50 ? "" : name);
      const table: any = {
        rest(...list: number[]) { return list.length; },
        counts() { return arguments.length; },
        Plain: function Plain(this: any, x: number) { this.x = table[key("rest")](x); },
        Class: class Class { x: number; constructor(x: number) { this.x = table[key("counts")](x); } },
        repeats(step: (x: number) => number) { let sum = 0; for (let i = 0; i < 1000; i++) sum += step(i); return sum; },
      };
      const list = [1, 2];
      function callsRest(x: number): number { return table[key("rest")](x, x) + 1; }
      function callsCounts(x: number): number { return table[key("counts")](x, x, x) + 1; }
      function spreads(x: number): number { return table[key("counts")](...list) + x; }
      function makesPlain(x: number): number { return new table[key("Plain")](...list).x + x; }
      function makesClass(x: number): number { return new table[key("Class")](...list).x + x; }
      let total = 0;
      for (const step of [callsRest, callsCounts, spreads, makesPlain, makesClass])
        for (const end = Date.now() + 300; Date.now() < end; ) total += table[key("repeats")](step);
      console.log(total > 0);`,
  });
  const cwd = String(dir);
  await buildProgramThatProfilesItself(cwd);
  const run = await spawned([join(cwd, "program")], cwd, bunEnv);
  expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });

  const callers: Record<string, string[]> = {
    repeats: ["(module)"],
    callsRest: ["repeats"],
    callsCounts: ["repeats"],
    spreads: ["repeats"],
    makesPlain: ["repeats"],
    makesClass: ["repeats"],
    Plain: ["makesPlain"],
    Class: ["makesClass"],
    rest: ["callsRest", "Plain"],
    counts: ["callsCounts", "spreads", "Class"],
  };
  const hits = hitCountsByCall(readNodes(join(cwd, "own.cpuprofile")));
  let right = 0;
  let wrong = 0;
  for (const [call, count] of Object.entries(hits)) {
    const [caller, callee] = call.split(" > ");
    if (callers[callee]?.includes(caller)) right += count;
    else if (callee in callers) wrong += count;
  }
  expect(hits).toSatisfy(() => right > 200 * wrong);
}, 120_000);

test("a function of WebAssembly has a frame of its own", async () => {
  using dir = tempDir("aot-cpu-profile-wasm", {
    // (table funcref (elem $leaf $framed))
    // (func $leaf (param $x i32) (result i32) (i32.mul (local.get $x) (local.get $x)))
    // (func $framed (param $x i32) (result i32) (i32.add (call_indirect (local.get $x) (i32.const 0)) (local.get $x)))
    // (func $loop (export "loop") (param $count i32) (param $callee i32) (result i32) ;; calls $callee $count times
    "module.wasm": Buffer.from(
      "0061736d01000000010c0260017f017f60027f7f017f030403000001040401700002070801046c6f6f7000020908010041000b0200010a35" +
        "030700200020006c0b0c002000410011000020006a0b1e01017f03402002200020011100006a2102200041016b22000d000b20020b" +
        "001c046e616d6501150300046c65616601066672616d656402046c6f6f70",
      "hex",
    ),
    "main.ts": `
      import path from "./module.wasm" with { type: "file" };
      const { exports } = new WebAssembly.Instance(new WebAssembly.Module(await Bun.file(path).bytes()));
      const loop = exports.loop as (count: number, callee: number) => number;
      let total = 0;
      for (const callee of [0, 1])
        for (const end = Date.now() + 500; Date.now() < end; ) total += loop(20_000, callee) | 1;
      console.log(total !== 0);`,
  });
  const cwd = String(dir);
  await buildProgramThatProfilesItself(cwd);
  const run = await spawned([join(cwd, "program")], cwd, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });

  expect(
    Object.keys(hitCountsByCall(readNodes(join(cwd, "own.cpuprofile"))))
      .filter(call => call.includes("> .wasm-function"))
      .sort(),
  ).toEqual([
    ".wasm-function[framed] > .wasm-function[leaf]",
    ".wasm-function[loop] > .wasm-function[framed]",
    ".wasm-function[loop] > .wasm-function[leaf]",
    "wasm-stub > .wasm-function[loop]",
  ]);
}, 120_000);

// musl keeps other values in rbp.
test.skipIf(!isLinux || process.arch !== "x64" || !!without("a C compiler"))(
  "time in a C library that overwrites the frame pointer belongs to the function that called it",
  async () => {
    using dir = tempDir("aot-cpu-profile-frame-pointer", {
      "library.c": `
        #define _GNU_SOURCE
        #include <dlfcn.h>
        #include <math.h>
        #include <time.h>
        #include <unistd.h>

        static void spin(void) {
          long count = 2000;
          __asm__ volatile("xor %%ebp, %%ebp\\n1: dec %0\\njnz 1b" : "+b"(count) : : "rbp", "cc");
        }

        #define SPIN_AND_CALL(name, ...) \\
          static __typeof__(name) *next; \\
          if (!next) next = dlsym(RTLD_NEXT, #name), write(2, #name "\\n", sizeof #name); \\
          spin(); \\
          return next(__VA_ARGS__)

        double sin(double x) { SPIN_AND_CALL(sin, x); }
        double pow(double x, double y) { SPIN_AND_CALL(pow, x, y); }
        int clock_gettime(clockid_t clock, struct timespec *time) { SPIN_AND_CALL(clock_gettime, clock, time); }`,
      "main.ts": `
        const table: any = {
          sine(x: number) { return Math.sin(x) + Math.sin(x + 1) * Math.sin(x + 2); },
          clock() { return performance.now() + performance.now() * performance.now(); },
          get getter() { return Date.now(); },
        };
        const key = (name: string) => (process.argv.length > 50 ? "" : name);
        function sines(): number { let sum = 0; for (let i = 0; i < 100; i++) sum += Math.sin(i + 0.5); return sum; }
        function powers(): number { let sum = 0; for (let i = 0; i < 100; i++) sum += (i + 0.5) ** 1.7; return sum; }
        function clocks(): number { let sum = 0; for (let i = 0; i < 100; i++) sum += performance.now(); return sum; }
        function dates(): number { let sum = 0; for (let i = 0; i < 100; i++) sum += new Date().getTime(); return sum; }
        function getters(): number { let sum = 0; for (let i = 0; i < 100; i++) sum += table[key("getter")]; return sum; }
        function alternates(): number {
          const both = [table[key("sine")], table[key("clock")]];
          let sum = 0;
          for (let i = 0; i < 100; i++) sum += both[i & 1](i + 0.5);
          return sum;
        }
        let total = 0;
        for (const step of [sines, powers, clocks, dates, getters, alternates])
          for (const end = Date.now() + 100; Date.now() < end; ) total += step();
        console.log(total > 0);`,
    });
    const cwd = String(dir);
    const [library] = await Promise.all([
      spawned(
        [cCompiler!, "-w", "-shared", "-fPIC", "-O2", "-fomit-frame-pointer", "-o", "library.so", "library.c", "-ldl"],
        cwd,
        bunEnv,
      ),
      buildProgramThatProfilesItself(cwd),
    ]);
    built(library);
    const run = await spawned([join(cwd, "program")], cwd, {
      ...bunEnv,
      LD_PRELOAD: [join(cwd, "library.so"), bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
    });
    expect({
      stdout: run.stdout,
      interposed: [...new Set(run.stderr.trimEnd().split("\n"))].sort(),
      exitCode: run.exitCode,
    }).toEqual({ stdout: "true\n", interposed: ["clock_gettime", "pow", "sin"], exitCode: 0 });

    expectSamplesIn(
      [
        "(module) > sines",
        "(module) > powers",
        "(module) > clocks",
        "dates > Date",
        "getters > getter",
        "alternates > sine",
        "alternates > clock",
      ],
      readNodes(join(cwd, "own.cpuprofile")),
    );
  },
  120_000,
);
