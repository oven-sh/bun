// A test run compiles what an executable compiles. The engine decides over the whole program what it cuts out into shared pieces and what counts as hot, so code that the
// runner brings along changes the code of the files under test. `bun:test` has fake timers: they load node:timers and node:timers/promises ahead of the fakes, queue ticks,
// and make an object for `performance` with a function of Bun's own. All of that hung on the name `bun:test`: 166 functions in a run of one empty test.
// Now each hangs on what can see it: the two modules on themselves, the tick on process.nextTick. The runner's function is never in a program.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

async function runTests(files: Record<string, string>, words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-none-of-the-runners-code", {
    "package.json": `{ "name": "p", "type": "module" }`,
    ...files,
  });
  const map = join(String(dir), "program.map");
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, [buildEnvironment.mapFilePath]: map };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  const functions = flags.includes("--aot") && !words ? readFileSync(map, "latin1").split("\n") : [];
  return {
    // The file of each function that is not the project's.
    ofLibrary: functions
      .map(row => row.split("\t"))
      .filter(columns => columns[0] === "F" && !(columns[10] ?? "").startsWith(String(dir)))
      .map(columns => columns[10]),
    seen: {
      stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")),
      results: [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`),
      exitCode,
    },
  };
}

test.concurrent(
  "a run of one empty test holds the test file and nothing else",
  async () => {
    const { ofLibrary, seen } = await runTests(
      { "a.test.ts": `import { test } from "bun:test";\ntest("runs", () => {});\n` },
      undefined,
      "--aot",
    );
    expect(seen).toEqual({ stdout: [], results: ["pass runs"], exitCode: 0 });
    expect(ofLibrary).toEqual([]);
  },
  120_000,
);

test.concurrent(
  "nor does a run of one test that expects something",
  async () => {
    const { ofLibrary, seen } = await runTests(
      {
        "a.test.ts": `import { test, expect } from "bun:test";\ntest("runs", () => {\n  expect(1 + 2).toBe(3);\n});\n`,
      },
      undefined,
      "--aot",
    );
    expect(seen).toEqual({ stdout: [], results: ["pass runs"], exitCode: 0 });
    expect(ofLibrary).toEqual([]);
  },
  120_000,
);

const withFakeTimers = {
  "lib.ts": `export const later = (ms: number, seen: string[]) => { setTimeout(() => seen.push("lib " + ms), ms); };\n`,
  "a.test.ts": `import { test, jest, vi } from "bun:test";
import { later } from "./lib";
test("jest", () => {
  const seen: string[] = [];
  jest.useFakeTimers();
  setTimeout(() => seen.push("own 100"), 100);
  later(200, seen);
  const before = performance.now(), date = Date.now();
  jest.advanceTimersByTime(150);
  console.log("SEEN at 150", seen.join(), performance.now() - before, Date.now() - date, typeof performance.mark, jest.getTimerCount());
  jest.runAllTimers();
  console.log("SEEN at the end", seen.join(), jest.getTimerCount());
  jest.useRealTimers();
  console.log("SEEN real", typeof setTimeout, setTimeout.name, typeof performance.timeOrigin);
});
test("vi", async () => {
  const seen: string[] = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
  setTimeout(() => seen.push("own 10"), 10);
  await vi.advanceTimersByTimeAsync(20);
  console.log("SEEN vi", seen.join(), Object.keys(performance).join(), JSON.stringify(performance.mark("m")), performance.getEntries().length);
  vi.useRealTimers();
});
`,
};

test.concurrent(
  "fake timers work as in plain Bun, and bring nothing into the program",
  async () => {
    const plain = await runTests(withFakeTimers, undefined);
    expect(plain.seen.results).toEqual(["pass jest", "pass vi"]);
    expect(plain.seen.stdout).toContain("SEEN at 150 own 100 150 150 function 1");
    const [oneProgram, layers] = await Promise.all([
      runTests(withFakeTimers, undefined, "--aot"),
      runTests(withFakeTimers, "TestRunLayers:2", "--aot"),
    ]);
    expect(oneProgram.seen).toEqual(plain.seen);
    expect(layers.seen).toEqual(plain.seen);
    // The ticks are the program's own: a timer whose delay is no number warns on the next tick.
    expect(oneProgram.ofLibrary.filter(file => /useFakeTimers|node:timers/.test(file))).toEqual([]);
  },
  240_000,
);

// Row 4121: compiled code took `process.nextTick` for the function that the process began with, so it never met the fake: "SEEN before faked".
test("a tick that is queued under fake timers, and one behind them", async () => {
  const files = {
    "a.test.ts": `import { test, jest } from "bun:test";
test("ticks", async () => {
  const seen: string[] = [];
  jest.useFakeTimers({ toFake: ["nextTick"] });
  const fake = process.nextTick;
  fake(() => seen.push("faked"));
  await Promise.resolve();
  console.log("SEEN before", seen.join());
  jest.runAllTicks();
  console.log("SEEN after", seen.join());
  jest.useRealTimers();
  fake(() => seen.push("the fake, behind the fakes"));
  process.nextTick(() => seen.push("real"));
  await new Promise(resolve => setImmediate(resolve));
  console.log("SEEN at the end", seen.join());
});
`,
  };
  const plain = await runTests(files, undefined);
  expect(plain.seen.results).toEqual(["pass ticks"]);
  expect((await runTests(files, undefined, "--aot")).seen).toEqual(plain.seen);
}, 120_000);
