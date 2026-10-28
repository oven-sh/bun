// A built-in that the table calls deterministic is called while the program is built, where all its operands are constants, and its answer
// stands in its place. The program does what it does in plain Bun, an error included, and the build does not make an answer that is too long to keep.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

const answers = `
const show = run => {
  try {
    console.log(JSON.stringify(run()));
  } catch (error) {
    console.log(error.name + ": " + error.message);
  }
};
show(() => "aBc".toUpperCase());
show(() => "aBc".toLowerCase());
show(() => "\\u00df\\ufb01".toUpperCase());
show(() => "ab".repeat(3));
show(() => "ab".repeat(0));
show(() => "ab".repeat(-1));
show(() => "ab".repeat(Infinity));
show(() => "".repeat(2 ** 40));
show(() => "ab".repeat(2 ** 29).length);
show(() => "ab".repeat(2 ** 31));
show(() => "ab".padStart(6, "xy"));
show(() => "ab".padEnd(7, "xy"));
show(() => "ab".padEnd(1));
show(() => "ab".padEnd(2 ** 30, "xy").length);
show(() => "ab".padStart(2 ** 31, "xy"));
show(() => "ab".padStart(2 ** 31, ""));
show(() => "e\\u0301".normalize());
show(() => "\\u00e9".normalize("NFD"));
show(() => "a".normalize("X"));
show(() => "a\\ud800".isWellFormed());
show(() => "a\\ud800".toWellFormed());
show(() => String.fromCharCode(97, 98, 0x1f600));
`;

async function build(source: string) {
  const dir = tempDir("aot-calls-at-build-time", { "main.js": source });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const process = Bun.spawn({
    cmd: [bunExe(), ...compileCommand, "main.js", "--outfile", executable],
    cwd: folder,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([process.stdout.text(), process.stderr.text(), process.exited]);
  built({ stdout, stderr, exitCode, signal: null });
  return { dir, folder, executable, peakMemory: process.resourceUsage()!.maxRSS };
}

describe.concurrent("calls made at build time", () => {
  test(
    "answer what plain Bun answers",
    () =>
      slot(async () => {
        const { dir, folder, executable } = await build(answers);
        using _ = dir;
        const plain = await spawned([bunExe(), "main.js"], folder, env);
        expect(plain.exitCode).toBe(0);
        expect(await spawned([executable], folder, env)).toEqual(plain);
      }),
    300_000,
  );

  for (const [title, expression] of [
    ["a count", `"ab".repeat(2 ** 29)`],
    ["a length", `"ab".padEnd(2 ** 30, "xy")`],
  ]) {
    test(
      `${title} that makes a gigabyte costs the build no gigabyte`,
      () =>
        slot(async () => {
          const small = await build(`console.log("ab".length);\n`);
          using _ = small.dir;
          const large = await build(`console.log(${expression}.length);\n`);
          using __ = large.dir;
          expect(large.peakMemory / small.peakMemory).toBeLessThan(2);
          expect((await spawned([large.executable], large.folder, env)).stdout).toBe("1073741824\n");
        }),
      300_000,
    );
  }
});
