// json() of a body that holds no JSON answers in an executable what it answers in plain Bun, whoever holds the body and by whatever road it reaches json().
// ./bodies-that-hold-no-json/write-the-program.ts says what the grid holds.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { parts, writeTheProgram } from "./bodies-that-hold-no-json/write-the-program";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";

const rows = { made: 595, fetched: 240, served: 48 };

test.skipIf(!!unsupported).each(parts)(
  "bodies that are %s",
  async part => {
    using dir = tempDir(`aot-bodies-that-hold-no-json-${part}`, { "main.ts": writeTheProgram(part) });
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const plain = await run([bunExe(), "run", "main.ts"], String(dir), bunEnv);
    const compiled = await run([executable], String(dir), bunEnv);
    expect({ stdout: compiled.stdout.split("\n"), exitCode: compiled.exitCode }).toEqual({
      stdout: plain.stdout.split("\n"),
      exitCode: 0,
    });
    expect(plain.stdout.trimEnd().split("\n").length).toBe(rows[part]);
  },
  240_000,
);
