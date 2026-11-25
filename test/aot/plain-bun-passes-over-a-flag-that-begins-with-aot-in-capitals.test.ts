// Bun passes over a long flag that it does not know. One that begins with "aot", as the flags of --aot are written, is answered; in any other case it is a flag like any other.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";

test.each(["--AOT", "--Aot", "--AOTEAROA"])("bun %s ./x.js runs the file", async flag => {
  using dir = tempDir("plain-bun-flag-in-capitals", { "x.js": `console.log("ran");\n` });
  const { stdout, exitCode } = await run([bunExe(), flag, "./x.js"], String(dir), bunEnv);
  expect({ stdout, exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
});
