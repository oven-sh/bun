import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `--debug-aot` is for Bun's own tests: `bun run` and `bun test` compile the whole program ahead of time and run the compiled code.
async function ran(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd, { ...bunEnv, BUN_AOT_VERBOSE: "1" });
  return { stdout, stderr, exitCode };
}

test("bun run --debug-aot runs compiled code", async () => {
  using dir = tempDir("debug-aot-run", { "main.ts": `const n: number = 20; console.log("said", n + 1);` });
  const { stdout, stderr, exitCode } = await ran(String(dir), ["run", "--debug-aot", "main.ts"]);
  expect(stderr).toContain("[aot] module: ");
  expect({ stdout, exitCode }).toEqual({ stdout: "said 21\n", exitCode: 0 });
});

test("bun test --debug-aot runs compiled code", async () => {
  using dir = tempDir("debug-aot-test", {
    "one.test.ts": `import { expect, test } from "bun:test"; test("adds", () => { const n: number = 20; expect(n + 1).toBe(21); });`,
  });
  const { stderr, exitCode } = await ran(String(dir), ["test", "--debug-aot", "one.test.ts"]);
  expect(stderr).toContain("[aot] module: ");
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
});

test("useFakeTimers() fakes the timers that compiled code calls", async () => {
  using dir = tempDir("debug-aot-fake-timers", {
    "timers.test.js": `
import { expect, test, vi } from "bun:test";
function run(toFake) {
  vi.useFakeTimers({ toFake });
  const fired = [];
  const timeout = setTimeout(() => fired.push("timeout"), 5);
  const interval = setInterval(() => fired.push("interval"), 4);
  const immediate = setImmediate(() => fired.push("immediate"));
  const count = vi.getTimerCount();
  vi.advanceTimersByTime(8);
  clearTimeout(timeout);
  clearInterval(interval);
  clearImmediate(immediate);
  vi.useRealTimers();
  return [count, fired.join()];
}
test("every timer", () => {
  expect(run(["setTimeout", "setInterval", "setImmediate"])).toEqual([3, "immediate,interval,timeout,interval"]);
});
test("only the timers in toFake", () => {
  expect(run(["setInterval"])).toEqual([1, "interval,interval"]);
  expect(run(["setImmediate"])).toEqual([1, "immediate"]);
});
test("the marker that @testing-library/dom looks for", () => {
  const seen = [Object.hasOwn(setTimeout, "clock")];
  vi.useFakeTimers();
  seen.push(Object.hasOwn(setTimeout, "clock"));
  vi.useRealTimers();
  seen.push(Object.hasOwn(setTimeout, "clock"));
  vi.useFakeTimers({ toFake: ["setInterval"] });
  seen.push(Object.hasOwn(setTimeout, "clock"));
  vi.useRealTimers();
  expect(seen).toEqual([false, true, false, false]);
});
`,
  });
  const { stderr, exitCode } = await ran(String(dir), ["test", "--debug-aot", "timers.test.js"]);
  expect(stderr).toContain("[aot] module: ");
  expect(stderr).toContain("3 pass");
  expect(exitCode).toBe(0);
});

test("mockRestore() puts back a property that a compiled object has outside its layout", async () => {
  using dir = tempDir("debug-aot-restore", {
    "restore.test.js": `
import { expect, spyOn, test } from "bun:test";
test("an index key and a key that is added later", () => {
  const indexed = { 0: 42 };
  spyOn(indexed, 0).mockRestore();
  const grown = { a: 1 };
  grown.b = 2;
  spyOn(grown, "b").mockRestore();
  expect([indexed, grown]).toEqual([{ 0: 42 }, { a: 1, b: 2 }]);
});
test("an inherited one is not copied", () => {
  const child = Object.create({ 0: 42, a: 1 });
  spyOn(child, 0).mockRestore();
  spyOn(child, "a").mockRestore();
  expect(Reflect.ownKeys(child)).toEqual([]);
});
`,
  });
  const { stderr, exitCode } = await ran(String(dir), ["test", "--debug-aot", "restore.test.js"]);
  expect(stderr).toContain("[aot] module: ");
  expect(stderr).toContain("2 pass");
  expect(exitCode).toBe(0);
});

test("spyOn() refuses the prototype of a compiled function", async () => {
  using dir = tempDir("debug-aot-prototype", {
    "prototype.test.js": `
import { expect, spyOn, test } from "bun:test";
test("as a value, by its getter and by its setter", () => {
  function Value() {}
  function Getter() {}
  function Setter() {}
  const message = "Cannot spy on the \`prototype\` property";
  expect(() => spyOn(Value, "prototype")).toThrow(message);
  expect(() => spyOn(Getter, "prototype", "get")).toThrow(message);
  expect(() => spyOn(Setter, "prototype", "set")).toThrow(message);
});
`,
  });
  const { stderr, exitCode } = await ran(String(dir), ["test", "--debug-aot", "prototype.test.js"]);
  expect(stderr).toContain("[aot] module: ");
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
});

test("a mock treats a compiled function as it treats any other", async () => {
  using dir = tempDir("debug-aot-mocks", {
    "mocks.test.js": `
import { expect, jest, mock, test, vi } from "bun:test";
const makers = [vi.fn, jest.fn, mock];
test("length", () => {
  expect(makers.map(fn => fn((a, b) => {}).length)).toEqual([2, 2, 2]);
});
function newTargetIn(fn, isClass) {
  let seen;
  function implementation() {
    seen = new.target;
  }
  class Implementation {
    constructor() {
      seen = new.target;
    }
  }
  const Mock = fn(isClass ? Implementation : implementation);
  new Mock();
  return seen === Mock ? "the mock" : seen;
}
test("new.target in a function, which only Vitest constructs", () => {
  expect(makers.map(fn => newTargetIn(fn, false))).toEqual(["the mock", undefined, undefined]);
});
test("new.target in a class", () => {
  expect(makers.map(fn => newTargetIn(fn, true))).toEqual(["the mock", "the mock", "the mock"]);
});
`,
  });
  const { stderr, exitCode } = await ran(String(dir), ["test", "--debug-aot", "mocks.test.js"]);
  expect(stderr).toContain("[aot] module: ");
  expect(stderr).toContain("3 pass");
  expect(exitCode).toBe(0);
});

test("toMatchSnapshot() prints its property matchers in place of a compiled object's values", async () => {
  using dir = tempDir("debug-aot-property-matchers", {
    "matchers.test.js": `
import { expect, test } from "bun:test";
class Point { x = 1; }
test("property matchers", () => {
  const received = { a: { b: false }, point: new Point(), c: 2 };
  expect(received).toMatchSnapshot({ a: { b: expect.any(Boolean) }, point: { x: expect.any(Number) } });
  expect(received).toEqual({ a: { b: false }, point: new Point(), c: 2 });
});
`,
    "__snapshots__/matchers.test.js.snap": [
      "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots",
      "",
      "exports[`property matchers 1`] = `",
      "{",
      '  "a": {',
      '    "b": Any<Boolean>,',
      "  },",
      '  "c": 2,',
      '  "point": Point {',
      '    "x": Any<Number>,',
      "  },",
      "}",
      "`;",
      "",
    ].join("\n"),
  });
  const { stderr, exitCode } = await ran(String(dir), ["test", "--debug-aot", "matchers.test.js"]);
  expect(stderr).toContain("[aot] module: ");
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
});

test("--help does not mention it", async () => {
  using dir = tempDir("debug-aot-help", {});
  for (const args of [["run", "--help"], ["test", "--help"], ["--help"]]) {
    const { stdout, stderr } = await ran(String(dir), args);
    expect(stdout + stderr).not.toContain("debug-aot");
  }
});
