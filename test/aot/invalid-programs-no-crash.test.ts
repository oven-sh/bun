// `bun check --aot` and `bun build --compile --aot` look at a program for the ahead-of-time compiler before they say what is wrong with it. A program that is wrong gets its errors, or is built: the
// tool does not end by a signal.
import { expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { unsupported } from "./run-programs";

const programs: Record<string, string> = {
  "a constant without an initializer that a loop stores to": "const v;\nfor (v of []) { }\n",
  "an exported constant without an initializer behind a label":
    "export const box: string\nlabel:\nexport const title: string\n",
  "`using` without an initializer": "function f() { using x; }\nasync function g() { await using y; }\nf();\n",
  "a guard of `this` on a function that has none":
    "function invalid(c: any): this is number { return false; }\ndeclare var c: number | number[];\nif (invalid(c)) { c; } else { c; }\n",
};

for (const [name, text] of Object.entries(programs)) {
  for (const words of [
    ["check", "--aot"],
    ["build", "--compile", "--aot", "--outfile", "program"],
  ]) {
    test.skipIf(!!unsupported)(
      `${name}: bun ${words[0]}`,
      async () => {
        using folder = tempDir("aot-wrong-programs", {});
        const entryPoint = join(String(folder), "main.ts");
        writeFileSync(entryPoint, text);
        await using spawned = Bun.spawn({
          cmd: [bunExe(), ...words, entryPoint],
          cwd: String(folder),
          env: bunEnv,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr] = await Promise.all([spawned.stdout.text(), spawned.stderr.text(), spawned.exited]);
        expect({ signal: spawned.signalCode, panics: (stdout + stderr).match(/\bpanic\w*\b.*/g) ?? [] }).toEqual({
          signal: null,
          panics: [],
        });
      },
      60_000,
    );
  }
}
