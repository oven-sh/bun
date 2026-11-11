// Bun.build passes over a key of `compile` that it does not know. One that begins with "aot", as the keys of --aot are written, is answered; in any other case it is a key like any other.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";

test.each(["AOT", "AOTname"])(
  "compile: { %s: 1 } builds",
  async key => {
    using dir = tempDir("plain-bun-key-in-capitals", {
      "build.js": `await Bun.build({ entrypoints: [import.meta.path], compile: { outfile: "./out", ${key}: 1 } });\nconsole.log("built");\n`,
    });
    const { stdout, exitCode } = await run([bunExe(), "./build.js"], String(dir), bunEnv);
    expect({ stdout, exitCode }).toEqual({ stdout: "built\n", exitCode: 0 });
  },
  120_000,
);
