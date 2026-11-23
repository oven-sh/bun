import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Compiled ahead of time, `Readable.from()` makes its stream without the list of options that `bun test` reads nine names off. That list inherits from
// `Object.prototype`, so a test that lays one of the names there can tell. A run with such a test takes the way of `bun test`.
const files = {
  "laid.test.js": `import { expect, test } from "bun:test";
import { Readable } from "node:stream";
test("emitClose is read off what the options inherit from", async () => {
  Object.prototype.emitClose = false;
  const stream = Readable.from([1]);
  delete Object.prototype.emitClose;
  let closed = false;
  stream.on("close", () => {
    closed = true;
  });
  for await (const _ of stream);
  await new Promise(setImmediate);
  expect(closed).toBe(false);
});
`,
  "not-laid.test.js": `import { expect, test } from "bun:test";
import { Readable } from "node:stream";
test("a stream closes", async () => {
  const stream = Readable.from([1]);
  let closed = false;
  stream.on("close", () => {
    closed = true;
  });
  for await (const _ of stream);
  await new Promise(setImmediate);
  expect(closed).toBe(true);
});
`,
};

test.each(Object.keys(files).flatMap(name => [[name], [name, "--aot"]]))(
  "%s %s",
  async (name, ...flags) => {
    using dir = tempDir("aot-a-name-laid-on-object-prototype", files);
    const tested = await run([bunExe(), "test", ...flags, "./" + name], String(dir), bunEnv);
    expect(tested.stderr).toContain("1 pass");
    expect(tested.exitCode).toBe(0);
  },
  60_000,
);
