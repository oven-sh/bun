// A file under a nested tsconfig.json is checked and lowered by a program of its own, beside the application's.
// An early error in such a file is only found while it is lowered. The build reports it and exits with 1.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { compileCommand, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const cases: Record<string, [text: string, code: string]> = {
  "a const declared twice": ["const taken = 1; const taken = 2; console.log(taken);", "TS2451"],
  "a const without a value": ["const empty;", "TS1155"],
  "break outside a loop": ["break;", "TS1105"],
};

for (const [name, [text, code]] of Object.entries(cases)) {
  for (const threads of [1, 4]) {
    test(`${name}, ${threads} threads`, async () => {
      using folder = tempDir("aot-early-error-under-nested-tsconfig", {
        "main.ts": `import "./sub/a.ts";\n`,
        "sub/a.ts": `${text}\nexport {};\n`,
        "sub/tsconfig.json": "{}\n",
      });
      const executable = join(String(folder), isWindows ? "program.exe" : "program");
      const command = [bunExe(), ...compileCommand, withThreads(threads), "./main.ts", "--outfile", executable];
      const built = await run(command, String(folder));
      expect({ exitCode: built.exitCode, namesError: built.stderr.includes(`error: ${code}:`) }).toEqual({
        exitCode: 1,
        namesError: true,
      });
    });
  }
}
