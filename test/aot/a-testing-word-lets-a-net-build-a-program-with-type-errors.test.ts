// The nets hold programs with type errors by the thousand, and a program that lies about a type may be written as a plain mismatch.
// `--aot-testing=TypeErrorsWarn` prints a type error as `bun test --aot` prints it and builds the executable. A type error takes no types away, so the word
// changes nothing that is compiled. It is a word of --aot-testing like any other: no user is told of it, and what refuses those refuses it.
import { describe, expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const WORD = "--aot-testing=TypeErrorsWarn";
const executable = (folder: string, name: string) => join(folder, isWindows ? name + ".exe" : name);
const build = (folder: string, entry: string, name: string, ...flags: string[]) =>
  spawned(
    [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation, ...flags, entry, "--outfile", name],
    folder,
    env,
  );
const codes = (stderr: string, label: string) =>
  stderr.split("\n").flatMap(line => new RegExp(`^${label}: (TS\\d+): `).exec(line)?.[1] ?? []);

describe.skipIf(!!unsupported)("--aot-testing=TypeErrorsWarn", () => {
  test("a type error is printed as a warning, and the executable answers as plain Bun", () =>
    slot(async () => {
      using dir = tempDir("aot-type-errors-warn", {
        "wrong.ts": `const port: number = "3000";\nconsole.log(typeof port, port);\n`,
      });
      const folder = String(dir);
      const stopped = await build(folder, "./wrong.ts", "stopped");
      expect({ errors: codes(stopped.stderr, "error"), exitCode: stopped.exitCode }).toEqual({
        errors: ["TS2322"],
        exitCode: 1,
      });
      expect(existsSync(executable(folder, "stopped"))).toBe(false);
      const warned = await build(folder, "./wrong.ts", "warned", WORD);
      expect({
        errors: codes(warned.stderr, "error"),
        warnings: codes(warned.stderr, "warn"),
        exitCode: warned.exitCode,
      }).toEqual({ errors: [], warnings: ["TS2322"], exitCode: 0 });
      const plain = await spawned([bunExe(), "./wrong.ts"], folder, env);
      const compiled = await spawned([executable(folder, "warned")], folder, env);
      expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
        stdout: plain.stdout,
        exitCode: plain.exitCode,
      });
      expect(plain.stdout).toBe("string 3000\n");
    }));

  test("an error that keeps the program from running stops the build all the same", () =>
    slot(async () => {
      using dir = tempDir("aot-type-errors-warn", { "twice.ts": `let twice;\nlet twice;\nexport {};\n` });
      const { stderr, exitCode } = await build(String(dir), "./twice.ts", "twice", WORD);
      expect({ errors: [...new Set(codes(stderr, "error"))], exitCode }).toEqual({ errors: ["TS2451"], exitCode: 1 });
    }));

  test("the executable of a program without a type error is the same to the byte with and without the word", () =>
    slot(async () => {
      const right = `interface Point { x: number; y: number }
const points: Point[] = [];
for (let i = 0; i < 3; i++) points.push({ x: i, y: i + 1 });
function sum(all: readonly Point[]): number { let total = 0; for (const point of all) total += point.x * point.y; return total; }
console.log(sum(points), points.map(point => point.x + point.y).join());
`;
      // Each in a folder of its own: an executable that already lies beside `right.ts` under the name `right` is a file that the second build finds on the disk.
      using dir = tempDir("aot-type-errors-warn", { "without/right.ts": right, "with/right.ts": right });
      const hashes: string[] = [];
      for (const [name, flags] of [
        ["without", []],
        ["with", [WORD]],
      ] as const) {
        const folder = join(String(dir), name);
        const { stderr, exitCode } = await build(folder, "./right.ts", "right", ...flags);
        expect({ said: codes(stderr, "error").concat(codes(stderr, "warn")), exitCode }).toEqual({
          said: [],
          exitCode: 0,
        });
        hashes.push(new Bun.CryptoHasher("sha256").update(readFileSync(executable(folder, "right"))).digest("hex"));
      }
      expect(hashes[0]).toBe(hashes[1]);
    }));

  test("the executable of a program with a type error is the same to the byte as with the error hidden by a comment of the same length", () =>
    slot(async () => {
      const line = `const port: number = "3000";\nconsole.log(typeof port, port);\n`;
      using dir = tempDir("aot-type-errors-warn", {
        "said/wrong.ts": `// @ts-expect-xxxxx\n${line}`,
        "hidden/wrong.ts": `// @ts-expect-error\n${line}`,
      });
      const hashes: string[] = [];
      for (const [name, flags] of [
        ["said", [WORD]],
        ["hidden", []],
      ] as const) {
        const folder = join(String(dir), name);
        expect((await build(folder, "./wrong.ts", "wrong", ...flags)).exitCode).toBe(0);
        hashes.push(new Bun.CryptoHasher("sha256").update(readFileSync(executable(folder, "wrong"))).digest("hex"));
      }
      expect(hashes[0]).toBe(hashes[1]);
    }));

  test("bun test and bun run take it as little as any other word of --aot-testing", () =>
    slot(async () => {
      using dir = tempDir("aot-type-errors-warn", {
        "a.test.ts": `import { expect, test } from "bun:test";\ntest("runs", () => { expect(1).toBe(1); });\n`,
      });
      for (const command of [
        ["test", "--aot"],
        ["run", "--aot"],
      ]) {
        const asked = (word: string) =>
          spawned([bunExe(), ...command, `--aot-testing=${word}`, "./a.test.ts"], String(dir), env);
        const [ours, other] = [await asked("TypeErrorsWarn"), await asked("NoExecutable")];
        expect({ stderr: ours.stderr, exitCode: ours.exitCode }).toEqual({
          stderr: other.stderr,
          exitCode: other.exitCode,
        });
        expect(ours.exitCode).not.toBe(0);
      }
    }));
});
