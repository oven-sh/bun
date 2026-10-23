import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";

test.skipIf(!!unsupported)(
  "what a program does to req, res, the socket and their prototypes is seen by node:http as without --aot",
  async () => {
    using dir = tempDir("aot-node-http-overrides", {
      "main.cjs": readFileSync(join(import.meta.dir, "node-http-overrides.fixture.js"), "utf8"),
    });
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const plain = await run([bunExe(), "run", "main.cjs"], String(dir), bunEnv);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode, lines: plain.stdout.split("\n").length > 300 }).toEqual({
      stderr: "",
      exitCode: 0,
      lines: true,
    });
    const compiled = await run([executable], String(dir), { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
      stdout: plain.stdout,
      stderr: "",
      exitCode: 0,
    });
  },
  240_000,
);
