import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// The compiler follows the text that a RegExp is made from, one level of its own stack for each concatenation. At the far end of the chain stands the source of a RegExp that is itself
// made from a text, which the compiler has to parse where it stands. A chain that is too long for that gets no compiled pattern and a warning: the build goes on, and the program answers.
// The patterns read the chain at many depths, the deepest first, so that one of them comes to the end with little stack left, however large a level is.

function chain(levels: number, link: (index: number) => string): string {
  const depths: number[] = [];
  for (let depth = levels; depth >= 300; depth *= 0.93) depths.push(Math.floor(depth));
  const lines = [
    `let seed = "p+";`,
    `if (process.argv.length > 7) seed = "q+";`,
    `function end(n) {`,
    `  if (n > 0) return end(n - 1);`,
    `  return new RegExp(seed).source;`,
    `}`,
    `const c0 = end(process.argv.length);`,
  ];
  for (let index = 1; index <= levels; index++) lines.push(`const c${index} = ${link(index)};`);
  lines.push(`const all = [${Array.from({ length: levels + 1 }, (_, index) => `c${index}`).join(", ")}];`);
  lines.push(`const patterns = [${depths.map(depth => `new RegExp(c${depth})`).join(", ")}];`);
  lines.push(
    `console.log(patterns.length, all.length, patterns.at(-1).test("a".repeat(${depths.at(-1)}) + "pp"), patterns[0].source.length, all[3]);`,
  );
  return lines.join("\n") + "\n";
}

test.concurrent.each([
  ["concatenations", (index: number) => `"a" + c${index - 1}`],
  ["templates", (index: number) => "`a${c" + (index - 1) + "}`"],
  ["concatenations on the other side", (index: number) => `c${index - 1} + "a"`],
] as const)(
  "a chain of 4,200 %s that ends in the source of a RegExp is compiled",
  async (_, link) => {
    using folder = tempDir("aot-long-chain-of-texts", { "program.js": chain(4200, link) });
    const spawn = (cmd: string[]) =>
      Bun.spawn({ cmd, cwd: String(folder), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    await using build = spawn([bunExe(), "build", "--compile", "--aot", "program.js", "--outfile", "program"]);
    const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
    expect({ stderr: buildErrors, exitCode: buildExitCode, signalCode: build.signalCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b|crashed/m),
      exitCode: 0,
      signalCode: null,
    });
    await using plain = spawn([bunExe(), "run", "program.js"]);
    await using program = spawn([join(String(folder), "program")]);
    const [expected, stdout, exitCode] = await Promise.all([
      plain.stdout.text(),
      program.stdout.text(),
      program.exited,
    ]);
    expect({ stdout, exitCode }).toEqual({ stdout: expected, exitCode: 0 });
    expect(expected).toStartWith("37 ");
  },
  240_000,
);
