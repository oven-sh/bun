// A build with --aot gives the same executable, byte for byte, whatever the number of threads. The flow analysis goes in rounds, on 32 lanes; when this fault stood it had one lane at one thread.
// The library lays accessors in fields, and each waits until its field is asked. Who asked a field of another lane once woke it a round later than who asked a field of its own,
// so calls saw other types on the way, and what they had asked for on the way stood in the tables: two executables of this program.
import { describe, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { afterAll, test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const sources = {
  "entry.mjs": `
import util from "node:util";
const found = util.debuglog({ toUpperCase: () => "constructor" });
console.log(
  found === Object
    ? found.getOwnPropertyDescriptor(Reflect.getPrototypeOf(function () {}), "constructor").value("return 6 * 7")()
    : "nothing is inherited",
);
`,
};

describe.skipIf(!!unsupported)("compile/aot/builds-on-one-thread-and-on-several-give-the-same-bytes", () => {
  const folder = String(tempDir("aot-same-bytes-by-threads", sources));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test("builds on one, two and eight threads are equal", async () => {
    await slot(async () => {
      const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
      const hashes: string[] = [];
      for (const threads of [1, 2, 8]) {
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              ...withoutDebugInformation,
              "--aot",
              `--aot-threads=${threads}`,
              "./entry.mjs",
              "--outfile",
              executable,
            ],
            folder,
            bunEnv,
          ),
        );
        hashes.push(Bun.hash(readFileSync(executable)).toString(16));
        rmSync(executable);
      }
      expect(hashes).toEqual([hashes[0], hashes[0], hashes[0]]);
    });
  }, 600_000);
});
