// node:tty lays getColorDepth on the prototype of its WriteStream by one store. An accessor under that name on Object.prototype hears that store and nothing else: no second store, no read.
// `bun run` evaluates src/js/internal/tty.ts and src/js/node/tty.ts, the compiler reads their second texts (src/js/ahead-of-time): both are held to it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

test("an accessor under get color depth hears one store", async () => {
  using dir = tempDir("aot-plain-library", {
    "package.json": `{ "name": "p" }`,
    "a.test.cjs": `const { test } = require("bun:test");
test("t", () => {
  let stores = 0, reads = 0;
  Object.defineProperty(Object.prototype, "getColorDepth", { configurable: true, get() { reads++; return undefined; }, set(value) { stores++; } });
  try { void require("node:tty").WriteStream.prototype; } finally { delete Object.prototype.getColorDepth; }
  console.error("SEEN " + stores + " " + reads);
});
`,
  });
  const seenWith = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    const lines = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN "));
    return { seen: lines, exitCode };
  };
  expect(await seenWith()).toEqual({ seen: ["SEEN 1 0"], exitCode: 0 });
  expect(await seenWith("--aot")).toEqual({ seen: ["SEEN 1 0"], exitCode: 0 });
});
