// `vi.mock("./lib", { spy: true })` replaces every function of the module by a mock function that still runs it. The test runner reads the module's exports for that, under a key of
// its own, and a compiled run refused the key: "Cannot load '..?actual&spy'".
// What else a mock without a factory once got wrong stands in ./fixed-runs: closed/automock-* and open/automock-behind-a-factory-and-a-reset. This case is silent beside others.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "mock-without-factory" }`,
  "lib.mjs": `console.log("OUT lib.mjs runs");
export let value = "real value";
export function f() { return "real f"; }`,
  "spy.test.mjs": `import { test, vi } from "bun:test";
import * as lib from "./lib.mjs";
vi.mock("./lib.mjs", { spy: true });
test("functions that are watched and still run", () => console.log("OUT", lib.value, lib.f(), lib.f.mock.calls.length));`,
};

async function run(dir: string, flags: string[], words = "", testFiles = ["./spy.test.mjs"]) {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, ...testFiles],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test("spy.test.mjs", async () => {
  using folder = tempDir("aot-mock-without-factory", files);
  const dir = String(folder);
  const plain = await run(dir, []);
  expect(plain).toEqual({ lines: ["OUT lib.mjs runs", "OUT real value real f 1"], exitCode: 0 });
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
}, 240_000);

// A module mocked without a factory waits for nothing once its original has run. Its importers run in the order of the import statements: ahead of the files that are imported
// behind them, and ahead of the jobs that the original queued. A compiled run held the importers back and ran what came behind them first. Above a cycle of imports, beside a mock
// whose factory is awaited, one of them never ran. Each folder is one way to come to such a mock.
const waysToTheMock: Record<string, Record<string, string>> = {
  // Two files hand the mocked module on, and an import call loads them.
  both: {
    "a.test.js": `import { test, vi } from "bun:test";
vi.mock("./dep.js");
test("both", async () => { const { read } = await import("./importer.js"); console.log("OUT both: in the test", read()); });`,
    "dep.js": `console.log("OUT both: dep runs"); export const greet = () => "real";`,
    "first.js": `console.log("OUT both: first runs"); export * from "./dep.js";`,
    "second.js": `console.log("OUT both: second runs"); export * from "./dep.js";`,
    "importer.js": `import { greet as first } from "./first.js"; import { greet as second } from "./second.js"; import { greet } from "./dep.js";
console.log("OUT both: importer runs");
export const read = () => [first(), second(), greet()].join();`,
  },
  // A statement of the test file loads them under a hoisted mock, and files that import nothing of the mock stand ahead of the importer and behind it.
  beside: {
    "a.test.js": `import { test, vi } from "bun:test";
import { read } from "./importer.js";
vi.mock("./dep.js");
test("beside", () => console.log("OUT beside: in the test", read()));`,
    "dep.js": `console.log("OUT beside: dep runs"); export const greet = () => "real";`,
    "ahead.js": `console.log("OUT beside: ahead runs"); export const ahead = "ahead";`,
    "first.js": `console.log("OUT beside: first runs"); export * from "./dep.js";`,
    "behind.js": `console.log("OUT beside: behind runs"); export const behind = "behind";`,
    "importer.js": `import { ahead } from "./ahead.js"; import { greet } from "./first.js"; import { behind } from "./behind.js";
console.log("OUT beside: importer runs");
export const read = () => [ahead, greet(), behind].join();`,
  },
  spy: {
    "a.test.js": `import { test, vi } from "bun:test";
vi.mock("./dep.js", { spy: true });
test("spy", async () => { const { read, first } = await import("./importer.js"); console.log("OUT spy: in the test", read(), vi.isMockFunction(first)); });`,
    "dep.js": `console.log("OUT spy: dep runs"); export const greet = () => "real";`,
    "first.js": `console.log("OUT spy: first runs"); export * from "./dep.js";`,
    "second.js": `console.log("OUT spy: second runs"); export * from "./dep.js";`,
    "behind.js": `console.log("OUT spy: behind runs"); export const behind = "behind";`,
    "importer.js": `import { greet as first } from "./first.js"; import { greet as second } from "./second.js"; import { behind } from "./behind.js";
console.log("OUT spy: importer runs");
export const read = () => [first(), second(), behind].join();
export { first };`,
  },
  // The original has run before the mock is laid.
  ran: {
    "a.test.js": `import { test, vi } from "bun:test";
test("ran", async () => {
  await import("./dep.js");
  vi.doMock("./dep.js");
  const { read } = await import("./importer.js");
  console.log("OUT ran: in the test", read());
});`,
    "dep.js": `console.log("OUT ran: dep runs"); export const greet = () => "real";`,
    "first.js": `console.log("OUT ran: first runs"); export * from "./dep.js";`,
    "behind.js": `console.log("OUT ran: behind runs"); export const behind = "behind";`,
    "importer.js": `import { greet } from "./first.js"; import { behind } from "./behind.js";
console.log("OUT ran: importer runs");
export const read = () => [greet(), behind].join();`,
  },
  jobs: {
    "a.test.js": `import { test, vi } from "bun:test";
vi.mock("./dep.js");
test("jobs", async () => { const { read } = await import("./importer.js"); console.log("OUT jobs: in the test", read()); });`,
    "dep.js": `console.log("OUT jobs: dep runs"); queueMicrotask(() => console.log("OUT jobs: the job of dep")); export const greet = () => "real";`,
    "first.js": `console.log("OUT jobs: first runs"); queueMicrotask(() => console.log("OUT jobs: the job of first")); export * from "./dep.js";`,
    "behind.js": `console.log("OUT jobs: behind runs"); queueMicrotask(() => console.log("OUT jobs: the job of behind")); export const behind = "behind";`,
    "importer.js": `import { greet } from "./first.js"; import { behind } from "./behind.js";
console.log("OUT jobs: importer runs");
export const read = () => [greet(), behind].join();`,
  },
  // A mock whose factory takes its original is awaited by its importers, and stands beside the mock that nothing waits for.
  mixed: {
    "a.test.js": `import { test, vi } from "bun:test";
vi.mock("./taken.js", original => (console.log("OUT mixed: the factory of taken"), { taken: () => "mock" }));
vi.mock("./dep.js");
test("mixed", async () => { const { read } = await import("./importer.js"); console.log("OUT mixed: in the test", read()); });`,
    "dep.js": `console.log("OUT mixed: dep runs"); export const greet = () => "real";`,
    "taken.js": `console.log("OUT mixed: taken runs"); export const taken = () => "real";`,
    "other.js": `console.log("OUT mixed: other runs"); export * from "./taken.js";`,
    "first.js": `console.log("OUT mixed: first runs"); export * from "./dep.js";`,
    "behind.js": `console.log("OUT mixed: behind runs"); export const behind = "behind";`,
    "importer.js": `import { taken } from "./other.js"; import { greet } from "./first.js"; import { behind } from "./behind.js";
console.log("OUT mixed: importer runs");
export const read = () => [taken(), greet(), behind].join();`,
  },
  // The importer of the mock is on a cycle of imports, and a mock whose factory is awaited stands beside it: back.js reads what first.js exports at its end.
  cycle: {
    "a.test.js": `import { test, vi } from "bun:test";
vi.mock("./taken.js", original => (console.log("OUT cycle: the factory of taken"), { taken: () => "mock" }));
vi.mock("./dep.js");
test("cycle", async () => { const { read } = await import("./importer.js"); console.log("OUT cycle: in the test", read()); });`,
    "dep.js": `console.log("OUT cycle: dep runs"); export const greet = () => "real";`,
    "taken.js": `console.log("OUT cycle: taken runs"); export const taken = () => "real";`,
    "other.js": `console.log("OUT cycle: other runs"); export * from "./taken.js";`,
    "round.js": `import { ofFirst } from "./first.js"; console.log("OUT cycle: round runs"); export const round = () => ofFirst;`,
    "first.js": `import { round } from "./round.js"; export * from "./dep.js";
console.log("OUT cycle: first runs"); export const ofFirst = "of first"; export const around = () => round();`,
    "back.js": `import { ofFirst } from "./first.js";
let seen; try { seen = ofFirst; } catch (error) { seen = error.name; }
console.log("OUT cycle: back runs and sees", seen); export const back = "back";`,
    "middle.js": `import { greet } from "./first.js"; import { back } from "./back.js";
console.log("OUT cycle: middle runs"); export const middle = () => [typeof greet, back];`,
    "importer.js": `import { taken } from "./other.js"; import { middle } from "./middle.js";
console.log("OUT cycle: importer runs");
export const read = () => [taken(), ...middle()].join();`,
  },
};

test("the importers of a mock without a factory run in the order of the import statements", async () => {
  const ways = Object.keys(waysToTheMock);
  using folder = tempDir("aot-mock-without-factory-order", {
    "package.json": `{ "name": "mock-without-factory-order", "type": "module" }`,
    ...Object.fromEntries(
      ways.flatMap(way => Object.entries(waysToTheMock[way]).map(([name, text]) => [`${way}/${name}`, text])),
    ),
  });
  const testFiles = ways.map(way => `./${way}/a.test.js`);
  // What each way printed, in the order in which it printed it.
  const byWay = ({ lines, exitCode }: Awaited<ReturnType<typeof run>>) => ({
    ...Object.fromEntries(
      ways.map(way => [
        way,
        lines.flatMap(line => (line.startsWith(`OUT ${way}: `) ? [line.slice(way.length + 6)] : [])),
      ]),
    ),
    exitCode,
  });
  const [plain, compiled] = await Promise.all([
    run(String(folder), [], "", testFiles),
    run(String(folder), ["--aot"], "", testFiles),
  ]);
  expect(byWay(plain)).toEqual({
    both: ["dep runs", "first runs", "second runs", "importer runs", "in the test ,,"],
    beside: ["ahead runs", "dep runs", "first runs", "behind runs", "importer runs", "in the test ahead,,behind"],
    spy: ["dep runs", "first runs", "second runs", "behind runs", "importer runs", "in the test real,real,behind true"],
    ran: ["dep runs", "first runs", "behind runs", "importer runs", "in the test ,behind"],
    jobs: [
      "dep runs",
      "first runs",
      "behind runs",
      "importer runs",
      "the job of dep",
      "the job of first",
      "the job of behind",
      "in the test ,behind",
    ],
    mixed: [
      "taken runs",
      "dep runs",
      "first runs",
      "behind runs",
      "the factory of taken",
      "other runs",
      "importer runs",
      "in the test mock,,behind",
    ],
    cycle: [
      "taken runs",
      "round runs",
      "dep runs",
      "first runs",
      "back runs and sees of first",
      "middle runs",
      "the factory of taken",
      "other runs",
      "importer runs",
      "in the test mock,function,back",
    ],
    exitCode: 0,
  });
  expect(byWay(compiled)).toEqual(byWay(plain));
}, 240_000);
