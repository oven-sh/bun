// The compiler has forms of its own for the coldest part of a large program: compact code, nothing copied into callers, no predictions. A program under 1,048,576 values has no such
// part, so no program under ./programs is ever compiled that way as it stands. Here some of them are: the limit is 65,536 values, and each program is followed by thousands of small
// functions that a loop calls, beside which everything the program itself does is cold. heat/cold-*.test.ts do the same to every program with an option of the compiler, in the `jsc` shell.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

const programs = [
  "calls/generic-copy-forms",
  "calls/generic-copies-with-added-members",
  "calls/members-called-by-signature",
  "typed-objects/generic-spread-for-bounded-type-parameter",
  "typed-objects/generic-spread-bound-with-layout",
  "nothing-throws-because-of-a-type/a-test-that-only-null-and-undefined-should-fail-is-failed-by-other-values",
  "native-callbacks/callbacks-html-rewriter-handlers",
];

function hotFunctions(count: number) {
  const functions = Array.from(
    { length: count },
    (_, i) =>
      `function hot${i}(a: number, b: number): number { let s = a * ${i + 1} + b; for (let k = 0; k < 3; k++) { s = (s * 31 + k * ${(i % 7) + 1}) % 1000003; if (s % ${(i % 5) + 2} === 0) s += b - k; else s -= a + k; } return s + (a > b ? a - b : b - a) * ${(i % 11) + 1}; }\n`,
  );
  const calls = Array.from({ length: count }, (_, i) => `  heat = (heat + hot${i}(round, ${i})) % 1000003;\n`);
  return `${functions.join("")}let heat = 0;\nfor (let round = 0; round < 3; round++) {\n${calls.join("")}}\nconsole.log(heat);\n`;
}

test.concurrent.each(programs)(
  "%s",
  async program => {
    using dir = tempDir("aot-cold-functions", {
      "main.ts": readFileSync(join(import.meta.dir, "programs", program + ".ts"), "utf8") + "\n" + hotFunctions(2600),
    });
    const cwd = String(dir);
    const executable = join(cwd, isWindows ? "main.exe" : "main");
    const built = await run(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--aot-limit=MaxWarmCodeValues:65536",
        "./main.ts",
        "--outfile",
        executable,
      ],
      cwd,
    );
    expect({ output: built.exitCode ? built.stdout + built.stderr : "", exitCode: built.exitCode }).toEqual({
      output: "",
      exitCode: 0,
    });
    const plain = await run([bunExe(), "run", "./main.ts"], cwd);
    expect(plain.exitCode).toBe(0);
    expect(await run([executable], cwd)).toEqual(plain);
  },
  240_000,
);
