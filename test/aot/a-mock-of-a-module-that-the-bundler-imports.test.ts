import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// "bun:wrap" holds what the bundler imports for the constructs it lowers, `using` among them. It is an ES module of Bun's own, compiled with the program like a file, and a program may
// name it as it names any module of Bun. A mock of it stands in its place for import() and require(), as a mock of "undici" does; what a file has already taken from it stays.
// Code that is not compiled imports it too, where Bun transpiles that code at run time: a Worker on a text gets Bun's own, whatever the image holds under the name.
const say = `const say = (label, run) => { let said; try { said = JSON.stringify(run()); } catch (error) { said = error.name + ": " + error.message; } console.log(label + " | " + said); };`;

test("a mock of bun:wrap", async () => {
  using dir = tempDir("a-mock-of-bun-wrap", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": "{}",
    "names-it-alone.test.js": `
      import { mock, test } from "bun:test";
      test("nothing of the program needs the module", async () => {
        ${say}
        say("alone: the mock", () => mock.module("bun:wrap", () => ({ added: 1, default: { added: 1 } })) ?? "taken");
        const imported = await import("bun:wrap");
        say("alone: import()", () => [imported.added ?? null, imported.default?.added ?? null, Object.keys(imported).sort()]);
        say("alone: require()", () => require("bun:wrap").added ?? null);
      });`,
    "uses-it.test.js": `
      import { mock, test } from "bun:test";
      function closes() { const log = []; { using a = { [Symbol.dispose]() { log.push("disposed"); } }; log.push("in"); } return log.join(); }
      test("the file has a using declaration", async () => {
        ${say}
        say("using: before", closes);
        say("using: the mock", () => mock.module("bun:wrap", () => ({ added: 1, default: { added: 1 } })) ?? "taken");
        const imported = await import("bun:wrap");
        say("using: import()", () => [imported.added ?? null, imported.default?.added ?? null, Object.keys(imported).sort()]);
        say("using: require()", () => require("bun:wrap").added ?? null);
        say("using: behind the mock", closes);
      });`,
    "starts-a-worker.test.js": `
      import { test } from "bun:test";
      import { Worker } from "node:worker_threads";
      test("a worker on a text", async () => {
        const text = "{ using a = { [Symbol.dispose]() {} }; } require('node:worker_threads').parentPort.postMessage('answered')";
        const worker = new Worker(text, { eval: true });
        const said = await new Promise((resolve, reject) => (worker.once("message", resolve), worker.once("error", reject)));
        console.log("worker: on a text | " + JSON.stringify(said));
        await worker.terminate();
      }, 20000);`,
    "helpers/names.js": `
      import { __callDispose as named } from "bun:wrap";
      import * as all from "bun:wrap";
      export const byName = () => named;
      export const byNamespace = () => all.__callDispose;`,
    "replaces-an-export.test.js": `
      import { mock, test } from "bun:test";
      test("an export that is there", async () => {
        ${say}
        const real = { ...(await import("bun:wrap")) };
        const replacement = () => "mocked";
        say("export: the mock", () => mock.module("bun:wrap", () => ({ ...real, __callDispose: replacement })) ?? "taken");
        const imported = await import("bun:wrap");
        const helper = await import("./helpers/names.js");
        say("export: import() | require() | a later file by name | by its namespace", () => [
          imported.__callDispose === replacement,
          require("bun:wrap").__callDispose === replacement,
          helper.byName() === replacement,
          helper.byNamespace() === replacement,
        ]);
      });`,
  });
  const seen = async (env: Record<string, string | undefined>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
    if (exitCode !== 0) console.error(stderr);
    // The parts of a run end in any order.
    return {
      exitCode,
      lines: stdout
        .split("\n")
        .filter(line => line.includes(" | "))
        .sort(),
    };
  };
  const plain = await seen(bunEnv);
  expect(plain.exitCode).toBe(0);
  expect(plain.lines.length).toBe(11);
  expect(plain.lines).toContain(`alone: import() | [1,1,["added","default"]]`);
  expect(await seen(bunEnv, "--aot")).toEqual(plain);
  expect(await seen({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }, "--aot")).toEqual(
    plain,
  );
});
