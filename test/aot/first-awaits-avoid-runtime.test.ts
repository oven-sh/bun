import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const calls = 2000;
// Fractions take a whole word of the frame each, so this many of them are more than the allocator of small objects has a size for, also where its blocks are 64 KB.
const fractionsInLargeFrame = Array.from({ length: 5000 }, (_, i) => "f" + i);
const files = {
  "main.mjs": `
    const calls = ${calls};
    const opens = [];
    function pending() {
      return new Promise(resolve => {
        opens.push(resolve);
      });
    }
    let made = 0;
    function fraction(seed) {
      return (seed + ++made) / 3;
    }
    async function awaitsPromise(gate, seed) {
      return (await gate) + seed;
    }
    async function leaf(gate) {
      return (await gate) + 1;
    }
    async function awaitsCall(gate, seed) {
      return (await leaf(gate)) + seed;
    }
    async function awaitsInLargeFrame(gate, seed) {
      const ${fractionsInLargeFrame.map(name => `${name} = fraction(seed)`).join(", ")};
      const value = await gate;
      return Math.round(value + ${fractionsInLargeFrame.join(" + ")});
    }
    function* counts(seed) {
      yield seed;
      yield seed + 1;
    }
    async function* countsLater(seed) {
      yield seed;
      yield seed + 1;
    }
    const sumOf = values => values.reduce((sum, value) => sum + value, 0);
    async function suspendAll(start) {
      const started = [];
      for (let i = 0; i < calls; i++) started.push(start(pending(), i));
      opens.forEach((open, i) => open(i));
      return sumOf(await Promise.all(started));
    }
    // Which of them steps the generators is known when the program runs.
    const steppers = {
      withoutValue: generator => generator.next(),
      withValue: generator => generator.next(1),
    };
    function createAll(create) {
      const created = [];
      for (let i = 0; i < calls; i++) created.push(create(i));
      return created.map(steppers[process.argv[3]]);
    }
    const cases = {
      pendingPromises: () => suspendAll(awaitsPromise),
      suspendedCalls: () => suspendAll(awaitsCall),
      largeFrames: () => suspendAll(awaitsInLargeFrame),
      generators: () => sumOf(createAll(counts).map(step => step.value)),
      asyncGenerators: async () => sumOf((await Promise.all(createAll(countsLater))).map(step => step.value)),
    };
    console.log(await cases[process.argv[2]]());
  `,
};

const operations = [
  "operationAOTSaveFrameAndAwait",
  "operationAOTSaveFrameAndAwaitCall",
  "operationAOTSaveFrameAndYield",
] as const;
type Entries = Record<(typeof operations)[number], "few" | "every call" | number>;
const few: Entries = {
  operationAOTSaveFrameAndAwait: "few",
  operationAOTSaveFrameAndAwaitCall: "few",
  operationAOTSaveFrameAndYield: "few",
};

test("the first suspension of an activation makes the object for its frame without a call into the run time", async () => {
  using dir = tempDir("aot-first-awaits", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  // The run time makes the first object of every block of the allocator.
  const told = (entries: number) =>
    entries < calls / 20 ? "few" : entries >= calls && entries < calls * 1.05 ? "every call" : entries;
  const counted = async (name: string, options: Record<string, string> = {}): Promise<Entries> => {
    const path = join(String(dir), ["counts", name, ...Object.keys(options)].join("-"));
    const interpreted = await run([bunExe(), "main.mjs", name, "withoutValue"], String(dir), bunEnv);
    expect(
      await run([executable, name, "withoutValue"], String(dir), {
        ...bunEnv,
        ...options,
        BUN_JSC_aotCountsPath: path,
      }),
    ).toEqual({ stdout: interpreted.stdout, stderr: "", exitCode: 0 });
    const counts: Record<string, number> = Object.fromEntries(operations.map(operation => [operation, 0]));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, operation] = line.split("\toperation:");
      if (operation !== undefined && operation in counts) counts[operation] = counts[operation]! + Number(count);
    }
    return Object.fromEntries(operations.map(operation => [operation, told(counts[operation]!)])) as Entries;
  };

  expect({
    pendingPromises: await counted("pendingPromises"),
    suspendedCalls: await counted("suspendedCalls"),
    generators: await counted("generators"),
    asyncGenerators: await counted("asyncGenerators"),
  }).toEqual({ pendingPromises: few, suspendedCalls: few, generators: few, asyncGenerators: few });

  expect({ largeFrames: await counted("largeFrames") }).toEqual({
    largeFrames: { ...few, operationAOTSaveFrameAndAwait: "every call" },
  });

  // A validating run lists every such object, which only the run time does. It also shows that each case suspends through the operation it is named for:
  // a renamed operation, a call that returns a promise after all, or generators that are never made would count none here.
  const validating = { BUN_JSC_validateAOTRuntime: "1" };
  expect({
    pendingPromises: await counted("pendingPromises", validating),
    suspendedCalls: await counted("suspendedCalls", validating),
    generators: await counted("generators", validating),
    asyncGenerators: await counted("asyncGenerators", validating),
  }).toEqual({
    pendingPromises: { ...few, operationAOTSaveFrameAndAwait: "every call" },
    suspendedCalls: {
      ...few,
      operationAOTSaveFrameAndAwait: "every call",
      operationAOTSaveFrameAndAwaitCall: "every call",
    },
    generators: { ...few, operationAOTSaveFrameAndYield: "every call" },
    asyncGenerators: { ...few, operationAOTSaveFrameAndYield: "every call" },
  });
}, 240_000);
