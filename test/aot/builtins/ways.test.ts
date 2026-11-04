// The compiler believes what the table of built-ins says of an object of the host, and a false line there is wrong code or a crash.
// The host makes some objects differently under `bun test`, in a Worker and in an executable, so ways.fixture.ts asks the live objects in
// each of those ways, without a compiler: the kind of every member, whether what it holds or answers lies inside its type, whether two
// paths lead to one object, and what is in the objects that native code makes by itself. differential.test.ts makes the calls, in one way.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isGlibc, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "../harness/commands";
import { describe, test } from "../supported";

const fixture = join(import.meta.dir, "ways.fixture.ts");
type Answer = { held: string[]; engine: string[]; counts: Record<string, number> };
type Environment = Record<string, string | undefined>;

const ways: Record<string, (folder: string, env: Environment) => Promise<{ stdout: string; stderr: string }>> = {
  "bun run": (folder, env) => spawned([bunExe(), "run", fixture], folder, env),
  "bun test": (folder, env) => spawned([bunExe(), "test", "./in.test.ts"], folder, { ...env, AOT_WAYS_STAYS: "1" }),
  "a Worker": (folder, env) => spawned([bunExe(), "run", "./worker.ts"], folder, env),
  "an executable": async (folder, env) => {
    const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
    built(await spawned([bunExe(), "build", "--compile", fixture, "--outfile", executable], folder, env));
    return await spawned([executable], folder, env);
  },
};

async function ask(way: string, more: Environment = {}): Promise<Answer> {
  using folder = tempDir("aot-ways", {
    "in.test.ts": `import ${JSON.stringify(fixture)};\nimport { test } from "bun:test";\ntest("asked", () => {});\n`,
    "worker.ts": `const worker = new Worker(${JSON.stringify(fixture)});\nawait new Promise(resolve => worker.addEventListener("close", resolve));\n`,
  });
  const { stdout, stderr } = await ways[way](String(folder), { ...bunEnv, ...more });
  const line = stdout.split("\n").find(line => line.startsWith("ANSWER "));
  if (line === undefined) throw new Error(`no answer:\n${stdout}\n${stderr}`);
  return JSON.parse(line.slice("ANSWER ".length));
}

// In every way.
const held = [
  // bun:ffi takes these three away when it is loaded, and the fixture loads every module. The statements are the library's, so the compiler sees them.
  "Bun.FFI.callback: is missing",
  "Bun.FFI.cfunction: is missing",
  "Bun.FFI.closeCallback: is missing",
  // The getter answers the global object and nothing else.
  "self: is an accessor, and the table says Namespace",
];
const engine = [
  // What the library adds when node:net, node:zlib and node:perf_hooks are loaded.
  "%BlockList%.prototype[kBlockListHandle]: is not in the table",
  "%NativeZlib%.prototype.jsref: is not in the table",
  "%SocketAddress%.prototype[kSocketAddressHandle]: is not in the table",
  "Performance.prototype.eventLoopUtilization: is not in the table",
  "Performance.prototype.nodeTiming: is not in the table",
  "Performance.prototype.timerify: is not in the table",
  "Bun.FFI.callback: is missing",
  "Bun.FFI.cfunction: is missing",
  "Bun.FFI.closeCallback: is missing",
  // realm-agreement.test.ts and own-properties.test.ts say why.
  "%EventEmitter%.prototype: inherits from another object than the table says",
  "TestContext: has a C++ class with callable instances, and the table says its instances are not functions",
  "globalThis.ShadowRealm: is not in the table",
  "self: is an accessor",
];
// In one way alone. The table says what is so in an executable; a test run is told of these by the runner.
const heldInOneWay: Record<string, string[]> = {
  "bun test": ["console.timeStamp: is missing"],
};
const engineInOneWay: Record<string, string[]> = {
  "bun test": ["console.timeStamp: is missing", "process.mainModule: is an accessor"],
  // The bundler's `require` in place of a module's own.
  "an executable": [
    "%ModuleRequirePrototype%.cache: is an accessor",
    "%ModuleRequirePrototype%.extensions: is an accessor",
    "%ModuleRequirePrototype%.main: has a setter, and the table says it has none",
  ],
};

// A walk that reaches little finds little.
const least = {
  members: 4000,
  values: 2400,
  accessors: 400,
  readsOfInstances: 500,
  sameObjects: 150,
  hostObjects: 9,
  modules: 70,
};

// The lists say what is so where they were written: which objects the host and the engine make differs between systems and kinds of build.
const areListsOfThisBuild = isGlibc && !isASAN && !isDebug;

describe.skipIf(!areListsOfThisBuild)("the live objects are what the table of built-ins says, in", () => {
  for (const way of Object.keys(ways)) {
    test.concurrent(way, async () => {
      const answer = await ask(way);
      expect(answer.held).toEqual([...held, ...(heldInOneWay[way] ?? [])].sort());
      expect(answer.engine).toEqual([...engine, ...(engineInOneWay[way] ?? [])].sort());
      expect(Object.entries(least).filter(([name, count]) => !(answer.counts[name] >= count))).toEqual([]);
    });
  }

  test("a line of the table that is false is found", async () => {
    const answer = await ask("bun run", { AOT_WAYS_BREAKS: "1" });
    expect(answer.held.filter(line => !held.includes(line))).toEqual([
      "Number.parseFloat: is another object than parseFloat, which the table says it is",
      "URL.prototype.port: read of an instance gives a number, and the table says String",
      "a member of process.release: is none of the names that the table lists",
      "a member of process.versions: holds a number, and the table says String",
      'process.arch: holds a string, and the table says "arm64" | "x64"',
      "process.pid: holds a string, and the table says Number",
    ]);
  });
});

// Compiled code reads a member once where the table says that nothing but the program writes it, and one program may hold many test files.
describe.skipIf(!areListsOfThisBuild)("between two files of a test run the host changes", () => {
  const between = join(import.meta.dir, "ways-between-files.fixture.ts");
  const file = `import { compareWithFirstFile } from ${JSON.stringify(between)};\nimport { test } from "bun:test";\ncompareWithFirstFile();\ntest("asked", () => {});\n`;
  test.concurrent.each([
    ["nothing", [], []],
    // The runner lays a new list over both for each file, and loads the bundler's helpers anew.
    [
      "the arguments where each file gets its modules anew",
      ["--isolate=modules"],
      ["bun:wrap", "Bun.argv", "process.argv"],
    ],
  ])("%s", async (_, flags, changed) => {
    using folder = tempDir("aot-ways-between", { "a.test.ts": file, "b.test.ts": file });
    const env = { ...bunEnv, AOT_WAYS_FIRST_FILE: join(String(folder), "first.json") };
    const { stdout, stderr } = await spawned(
      [bunExe(), "test", ...flags, "./a.test.ts", "./b.test.ts"],
      String(folder),
      env,
    );
    const line = stdout.split("\n").find(line => line.startsWith("ANSWER "));
    if (line === undefined) throw new Error(`no answer:\n${stdout}\n${stderr}`);
    expect(JSON.parse(line.slice("ANSWER ".length))).toEqual({ changed, compared: expect.any(Number) });
    expect(JSON.parse(line.slice("ANSWER ".length)).compared).toBeGreaterThan(4000);
  });
});
