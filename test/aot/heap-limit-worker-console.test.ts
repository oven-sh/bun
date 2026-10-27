import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// In a node:worker_threads Worker, console.log writes to a stream that is written in JavaScript, so it allocates.

test.concurrent.each(["log", "error"])(
  "console.%s prints or throws in a Worker whose heap is full",
  async method => {
    using folder = tempDir("aot-heap-limit-worker-console", {
      "program.ts": `import { Worker } from "node:worker_threads";
const worker = new Worker(new URL("./worker.ts", import.meta.url));
worker.on("error", error => console.log("the worker ended:", error.constructor.name));
worker.on("exit", code => console.log("exit", code));
`,
      "worker.ts": `let returned = 0;
function fill(make: (index: number) => bigint) {
  const lists: bigint[][] = [];
  try {
    for (;;) {
      const items: bigint[] = [];
      lists.push(items);
      for (let index = 0; index < 1024; index++) items.push(make(index));
    }
  } catch {
    try {
      console.${method}("caught");
      returned++;
    } catch {}
  }
  return lists.length;
}
const filled = fill(index => BigInt(index) + 1n) > 100 && fill(index => BigInt(index) << 64n) > 100;
console.${method}("the end", filled, returned);
`,
    });
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "program.ts", "worker.ts", "--outfile", "program"],
      String(folder),
    );
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
    const { stdout, stderr, exitCode } = await run([join(String(folder), "program")], String(folder), {
      ...bunEnv,
      BUN_JSC_markedBlockCageSizeInMB: "64",
    });
    const lines = (method === "log" ? stdout : stderr).split("\n");
    const printed = lines.filter(line => line === "caught").length;
    const rest = method === "log" ? ["exit 0", ""] : [""];
    expect({ lines, exitCode }).toEqual({
      lines: [...Array(printed).fill("caught"), `the end true ${printed}`, ...rest],
      exitCode: 0,
    });
  },
  120_000,
);

test("a Console hands a line to its stream once, whatever write() throws", async () => {
  using folder = tempDir("aot-console-writes-a-line-once", {
    "program.cjs": `const { Console } = require("node:console");
const { Writable } = require("node:stream");
const fs = require("node:fs");
function throwOnce() {
  if (throwOnce.done) return;
  throwOnce.done = true;
  throw new RangeError("Out of memory");
}
const stream = new Writable({
  write(chunk, encoding, done) {
    fs.writeSync(1, chunk);
    done();
    throwOnce();
  },
});
new Console(stream).log("through a stream that finishes at once");
throwOnce.done = false;
const writer = {
  write(text) {
    fs.writeSync(1, text);
    throwOnce();
  },
  listenerCount: () => 1,
  removeListener() {},
};
new Console(writer).log("through an object with a method write");
`,
  });
  const expected = {
    stdout: "through a stream that finishes at once\nthrough an object with a method write\n",
    stderr: "",
    exitCode: 0,
  };
  expect(await run([bunExe(), "run", "program.cjs"], String(folder))).toEqual(expected);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "program.cjs", "--outfile", "program"],
    String(folder),
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  expect(await run([join(String(folder), "program")], String(folder))).toEqual(expected);
}, 120_000);
