// A program that replaces Readable.prototype.removeListener and `off` has let go of Bun's own function, and `bun run` holds it nowhere else: it is collected.
// Compiled code does hold it: the text of node:_http_server that the compiler reads calls it without a lookup. So this asks `bun run` alone.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

test("plain Bun lets go of the removeListener of streams", async () => {
  using dir = tempDir("aot-plain-library", {
    "main.cjs": `const { Readable } = require("node:stream");
const held = new WeakRef(Readable.prototype.removeListener);
Readable.prototype.removeListener = Readable.prototype.off = function () {};
setTimeout(() => {
  Bun.gc(true);
  console.log(held.deref() === undefined);
}, 10);
`,
  });
  const { stdout, exitCode } = await run([bunExe(), "main.cjs"], String(dir), bunEnv);
  expect({ stdout, exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
});
