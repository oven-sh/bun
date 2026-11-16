import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { isHardened } from "./hardened";
import { run } from "./harness/run";
import { test } from "./supported";

// `--debug-aot` compiles the program into a file without a name and runs it from there in a second process.
test.skipIf(!isHardened)(
  "a hardened build runs no compiled code out of another file",
  async () => {
    using directory = tempDir("aot-hardened-other-file", { "program.ts": `console.log("answer", 1 + 1);\n` });
    expect(await run([bunExe(), "--debug-aot", join(String(directory), "program.ts")])).toEqual({
      stdout: "",
      stderr:
        "error: can't run this executable's compiled code: this build of Bun only runs compiled code that is part of the executable itself\n",
      exitCode: 1,
    });
  },
  120_000,
);
