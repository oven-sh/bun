// What a program can see of the load of node:_stream_duplex: Object.defineProperties is read once, out of one pattern with its neighbors.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

test("duplex reads define properties once while it loads", async () => {
  using dir = tempDir("aot-plain-library", {
    "package.json": `{ "name": "p" }`,
    "a.test.cjs": `const { test } = require("bun:test");
test("t", () => {
  require("node:_stream_readable");
  require("node:_stream_writable");
  const real = Object.defineProperties;
  let reads = 0;
  Object.defineProperty(Object, "defineProperties", { configurable: true, get() { reads++; return real; } });
  try { require("node:_stream_duplex"); } finally { Object.defineProperty(Object, "defineProperties", { configurable: true, writable: true, value: real }); }
  console.error("SEEN " + reads);
});
`,
  });
  const seenWith = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    const lines = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN "));
    return { seen: lines, exitCode };
  };
  expect(await seenWith()).toEqual({ seen: ["SEEN 1"], exitCode: 0 });
  expect(await seenWith("--aot")).toEqual({ seen: ["SEEN 1"], exitCode: 0 });
});
