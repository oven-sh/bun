import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned } from "./run-programs";
import { test } from "./supported";

const program = join(import.meta.dir, "programs", "typed-objects", "detached-methods-many-lengths.ts");
const python = Bun.which("python3");
const script = [process.env.BUN_WEBKIT_PATH, join(import.meta.dir, "..", "..", "vendor", "WebKit")]
  .filter(path => path !== undefined)
  .map(path => join(path, "Tools", "Scripts", "aot", "check-paired-returns.py"))
  .find(path => existsSync(path));

const whySkipped =
  process.arch !== "arm64"
    ? "the check reads ARM64 code"
    : !python
      ? "python3 is not installed"
      : !script
        ? "there is no Tools/Scripts/aot/check-paired-returns.py in $BUN_WEBKIT_PATH or vendor/WebKit"
        : undefined;
if (whySkipped) console.error(`SKIPPED: test/aot/paired-returns.test.ts: ${whySkipped}`);

test.skipIf(!!whySkipped)(
  "no stub computes a return address or returns with an indirect jump",
  () =>
    slot(async () => {
      using dir = tempDir("aot-paired-returns", {});
      const folder = String(dir);
      const executable = join(folder, isWindows ? "entry.exe" : "entry");
      const map = join(folder, "entry.map");
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", program, "--outfile", executable], folder, {
          ...bunEnv,
          BUN_JSC_aotMapFilePath: map,
        }),
      );

      const { stdout, stderr, exitCode } = await spawned(
        [python!, script!, "--image", executable, "--map", map],
        folder,
        bunEnv,
      );
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: expect.stringMatching(/^[1-9]\d* stubs in \d+ bytes, \d+ cop(y|ies): 0 unpaired returns\r?\n$/),
        stderr: "",
        exitCode: 0,
      });
    }),
  300_000,
);
