// An emitter that captures rejections gets an `emit` of its own. Compiled ahead of time the library stored it with Object.assign, which a test may have replaced: a spy counted a call that
// plain Bun does not make, and behind a stand-in that does nothing the emitter captured nothing.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

test("a spy on Object.assign sees no call, and a stand-in for it changes nothing", async () => {
  using dir = tempDir("capturing-emitter", {
    "one.test.js": `
      import { expect, spyOn, test } from "bun:test";
      import EventEmitter from "node:events";
      import { Readable } from "node:stream";
      test("a spy that calls through", () => {
        const assign = spyOn(Object, "assign");
        new EventEmitter({ captureRejections: true });
        new Readable({ captureRejections: true });
        const calls = assign.mock.calls.length;
        assign.mockRestore();
        console.log("calls:", calls);
      });
      test("a stand-in that does nothing", async () => {
        const assign = spyOn(Object, "assign").mockImplementation(() => {});
        const emitter = new EventEmitter({ captureRejections: true });
        assign.mockRestore();
        console.log("an emit of its own:", Object.hasOwn(emitter, "emit"));
        const caught = new Promise(resolve => emitter.on("error", error => resolve(error.message)));
        emitter.on("made-up", async () => { throw new Error("rejected"); });
        emitter.emit("made-up");
        console.log("caught:", await caught);
      });
    `,
  });
  const plain = await runTests(String(dir));
  expect(plain.results).toEqual(["pass a spy that calls through", "pass a stand-in that does nothing"]);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
});
