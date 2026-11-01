// `jest.useFakeTimers()` puts functions of the runner's own in the place of `setTimeout` .. `queueMicrotask` on the global object and of `process.nextTick`. Compiled code took
// those names for what the process began with, so the real functions themselves asked the fake clock: a function that a file had kept before the call was faked too
// (`const macrotask = setImmediate` at the head of a file, awaited under fake timers: the test timed out), `kept === setImmediate` stayed true, and a tick was never faked.
// For the build such a call is now a store to those names, as `globalThis.setTimeout = f` is. `vi.stubGlobal(name, value)` is one to `globalThis[name]`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "kept.test.js": `import { afterEach, jest, test, vi } from "bun:test";
const kept = { setTimeout, setImmediate, nextTick: process.nextTick, queueMicrotask };
const macrotask = setImmediate;
afterEach(() => jest.useRealTimers());
test("a function kept before the call is the real one", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "setImmediate", "nextTick", "queueMicrotask"] });
  console.log("SEEN the same", kept.setTimeout === setTimeout, macrotask === globalThis.setImmediate, kept.nextTick === process.nextTick, kept.queueMicrotask === queueMicrotask);
  await new Promise(resolve => macrotask(resolve));
  await new Promise(resolve => kept.setTimeout(resolve, 1));
  await new Promise(resolve => kept.nextTick(resolve));
  console.log("SEEN they ran", jest.getTimerCount());
}, 5000);
test("what is called by name is counted by the clock", () => {
  jest.useFakeTimers({ toFake: ["setTimeout", "nextTick", "queueMicrotask"] });
  const ran = [];
  setTimeout(() => ran.push("timeout"), 1000);
  process.nextTick(() => ran.push("tick"));
  queueMicrotask(() => ran.push("microtask"));
  console.log("SEEN counted", jest.getTimerCount(), ran.join());
  jest.runAllTicks();
  jest.advanceTimersByTime(1000);
  console.log("SEEN ran", ran.join());
});
test("behind useRealTimers() the names are what they were", () => {
  console.log("SEEN back", kept.setTimeout === setTimeout, macrotask === setImmediate, kept.nextTick === process.nextTick, kept.queueMicrotask === queueMicrotask);
});
`,
  "stub.test.js": `import { test, vi } from "bun:test";
import { pathToFileURL } from "node:url";
const names = ["Headers"];
test("a stubbed global is read by the run's own code", () => {
  vi.stubGlobal("fetch", () => 7);
  vi.stubGlobal("URL", class { href = "stub"; });
  for (const name of names) vi.stubGlobal(name, name);
  console.log("SEEN stubbed", fetch(), globalThis.fetch(), new URL("x").href, Headers, pathToFileURL("/a").protocol);
  vi.unstubAllGlobals();
  console.log("SEEN back", typeof fetch, new URL("http://a/").href, typeof Headers);
});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  return {
    stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")),
    results: [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`),
    exitCode,
  };
}

test("compiled, fake timers and stubbed globals are what they are in plain Bun", async () => {
  using dir = tempDir("aot-fake-timers-replace-the-globals", files);
  const plain = await runTests(String(dir), undefined);
  expect(plain).toEqual({
    stdout: [
      "SEEN the same false false false false",
      "SEEN they ran 0",
      "SEEN counted 3 ",
      "SEEN ran tick,microtask,timeout",
      "SEEN back true true true true",
      "SEEN stubbed 7 7 stub Headers file:",
      "SEEN back function http://a/ function",
    ],
    results: [
      "pass a function kept before the call is the real one",
      "pass what is called by name is counted by the clock",
      "pass behind useRealTimers() the names are what they were",
      "pass a stubbed global is read by the run's own code",
    ],
    exitCode: 0,
  });
  const [oneProgram, layers] = await Promise.all([
    runTests(String(dir), undefined, "--aot"),
    runTests(String(dir), "TestRunLayers:2", "--aot"),
  ]);
  expect(oneProgram).toEqual(plain);
  expect(layers).toEqual(plain);
}, 240_000);
