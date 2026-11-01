import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "helpers/theirs.js": `import fs from "node:fs";
export const theirCallbacks = {
  stat: () => fs.statSync("/no/such/file"),
  decode: () => decodeURIComponent("%"),
};
export const theirCallers = {
  sort: callback => [2, 1].sort(callback),
  reviver: callback => JSON.parse("1", callback),
  text: callback => new Function("callback", "return [callback()]")(callback),
  proxy: callback => [new Proxy(callback, {})()],
};
`,
  "a.test.js": `import { expect, test } from "bun:test";
import fs from "node:fs";
import { theirCallbacks, theirCallers } from "./helpers/theirs.js";

const myCallbacks = {
  stat: () => fs.statSync("/no/such/file"),
  decode: () => decodeURIComponent("%"),
};
const myCallers = {
  sort: callback => [2, 1].sort(callback),
  reviver: callback => JSON.parse("1", callback),
  text: callback => new Function("callback", "return [callback()]")(callback),
  proxy: callback => [new Proxy(callback, {})()],
};
const ways = [];
for (const [whoseCaller, callers] of [["my", myCallers], ["their", theirCallers]]) {
  for (const [whoseCallback, callbacks] of [["my", myCallbacks], ["their", theirCallbacks]]) {
    for (const caller of Object.keys(callers)) {
      for (const callback of Object.keys(callbacks)) {
        ways.push([whoseCaller + " " + caller + " calls " + whoseCallback + " " + callback, callers[caller], callbacks[callback]]);
      }
    }
  }
}
function catchFrom(caller, callback) {
  const throughOne = function diesAtOnce() {
    return [caller(callback)];
  };
  try {
    throughOne();
  } catch (error) {
    return error;
  }
}
function say(title, name, errors) {
  const shapes = new Map();
  for (const error of errors) {
    const names = error.stack.split("\\n").slice(1, 6).map(line => line.trim().replace(/ ?\\(.*$/, "").replace(/^at (\\/|file:|[A-Za-z]:\\\\).*/, "at a file"));
    const shape = error.name + ": " + names.join(" < ");
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
  }
  for (const shape of [...shapes.keys()].sort()) console.log("SEEN " + title + " | " + name + " | " + shapes.get(shape) + " | " + shape);
}

test("read at once", () => {
  for (const [name, caller, callback] of ways) {
    const errors = [];
    for (let i = 0; i < 100; i++) errors.push(catchFrom(caller, callback));
    say("read at once", name, errors);
  }
});

test("kept through a collection", () => {
  const kept = [];
  for (const [name, caller, callback] of ways) {
    const errors = [];
    for (let i = 0; i < 100; i++) errors.push(catchFrom(caller, callback));
    kept.push([name, errors]);
  }
  Bun.gc(true);
  Bun.gc(true);
  for (const [name, errors] of kept) say("kept", name, errors);
  expect(kept.length).toBe(32);
});
`,
  "b.test.js": `import { expect, test } from "bun:test";\ntest("another file", () => expect(1).toBe(1));\n`,
};

async function seenIn(directory: string, env: Record<string, string>, ...flags: string[]) {
  const command = [bunExe(), "test", "--isolate", "--timeout=60000", ...flags];
  const { stdout, exitCode } = await run(command, directory, { ...bunEnv, ...env });
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}

test("a callback whose last call is a built-in that throws, called by a built-in", async () => {
  using dir = tempDir("aot-error-from-a-built-in-that-a-callback-calls-last", files);
  const plain = await seenIn(String(dir), {});
  expect(plain.exitCode).toBe(0);
  expect(plain.seen.length).toBe(64);
  const oneProgram = { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" };
  const layers = { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" };
  expect(await seenIn(String(dir), oneProgram, "--aot")).toEqual(plain);
  expect(await seenIn(String(dir), layers, "--aot")).toEqual(plain);
  expect(await seenIn(String(dir), { ...layers, BUN_JSC_validateAOTRuntime: "1" }, "--aot")).toEqual(plain);
}, 240_000);
