// A regular expression literal that the language refuses is an early error: nothing of the file runs, also where nothing reaches the literal.
// Each row is run by plain Bun. Where that fails, `bun build --compile --aot` fails and so does `bun run --aot`; where it runs, all three print the same.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./run-programs";

// prettier-ignore
const rows = [
  "function never() { return /a{2,1}/; } console.log(1);",
  "function never() { return /(?<n>a)(?<n>b)/; } console.log(1);",
  "function never() { return /\\p{Nope}/u; } console.log(1);",
  "function never() { return /(/; } console.log(1);",
  "function never() { return /a/gg; } console.log(1);",
  "function never() { return /a/x; } console.log(1);",
  "function never() { return /a/uv; } console.log(1);",
  "function never() { return /\\k<n>/u; } console.log(1);",
  "function never() { return /(?<n>a)\\k<m>/; } console.log(1);",
  "function never() { return /[b-a]/; } console.log(1);",
  "function never() { return /\\u{110000}/u; } console.log(1);",
  "function never() { return /(?<=a)+/u; } console.log(1);",
  "function never() { return /\\1(a)/u; } console.log(1);",
  "function never() { return /\\2(a)/u; } console.log(1);",
  "function never() { return /a**/; } console.log(1);",
  "function never() { return /[\\d-a]/u; } console.log(1);",
  "function never() { return /\\c/u; } console.log(1);",
  "function never() { return /{1}/u; } console.log(1);",
  "function never() { return /]/u; } console.log(1);",
  "function never() { return /(?i:a)/; } console.log(1);",
  "function never() { return /(?i-i:a)/; } console.log(1);",
  "function never() { return /[[a]--[b]]/v; } console.log(1);",
  "function never() { return /[a--b&&c]/v; } console.log(1);",
  "function never() { return /(?<n>a)|(?<n>b)/; } console.log(1);",
  "try { console.log(/a{2,1}/.source); } catch (e) { console.log(e.constructor.name); }",
  "console.log(1); if (false) { /(/.test(\"a\"); }",
  "const f = () => /\\p{Nope}/u; console.log(typeof f);",
  "class K { m() { return /a/gg; } } console.log(typeof K);",
  "console.log(/\\2(a)/.test(\"\\x02a\"), /{1}/.test(\"{1}\"), /]/.test(\"]\"), /\\c/.test(\"\\\\c\"), /[\\d-a]/.test(\"-\"));",
  "console.log(/(?<n>a)|(?<n>b)/.exec(\"b\").groups.n, /(?i:a)b/.test(\"Ab\"), /[[a-c]--[b]]/v.test(\"b\"));",
];

describe.skipIf(!!unsupported)("compile/aot/regular expression literals that the language refuses", () => {
  const root = String(tempDir("aot-regexp-literals", {}));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  rows.forEach((row, index) => {
    test.each(["main.mjs", "main.ts"])(
      row + " %s",
      file =>
        slot(async () => {
          const folder = join(root, index + file);
          mkdirSync(folder, { recursive: true });
          writeFileSync(join(folder, file), (file.endsWith(".ts") ? "// @ts-nocheck\n" : "") + row + "\n");
          const executable = join(folder, isWindows ? "program.exe" : "program");
          const plain = await spawned([bunExe(), "run", file], folder, bunEnv);
          const build = await spawned(
            [bunExe(), "build", "--compile", "--aot", file, "--outfile", executable],
            folder,
            bunEnv,
          );
          const fromSources = await spawned([bunExe(), "run", "--aot", file], folder, bunEnv);
          expect(plain.signal).toBeNull();
          if (plain.exitCode !== 0) {
            expect(plain.stderr).toContain("regular expression");
            expect({
              signal: build.signal,
              exitCode: build.exitCode,
              says: (build.stdout + build.stderr).includes("regular expression"),
            }).toEqual({ signal: null, exitCode: 1, says: true });
            expect({ signal: fromSources.signal, exitCode: fromSources.exitCode, stdout: fromSources.stdout }).toEqual({
              signal: null,
              exitCode: plain.exitCode,
              stdout: "",
            });
            return;
          }
          expect({ signal: build.signal, exitCode: build.exitCode }).toEqual({ signal: null, exitCode: 0 });
          const compiled = await spawned([executable], folder, bunEnv);
          rmSync(executable, { force: true });
          expect({ signal: compiled.signal, exitCode: compiled.exitCode, stdout: compiled.stdout }).toEqual({
            signal: null,
            exitCode: 0,
            stdout: plain.stdout,
          });
          expect({ signal: fromSources.signal, exitCode: fromSources.exitCode, stdout: fromSources.stdout }).toEqual({
            signal: null,
            exitCode: 0,
            stdout: plain.stdout,
          });
        }),
      600_000,
    );
  });
});
