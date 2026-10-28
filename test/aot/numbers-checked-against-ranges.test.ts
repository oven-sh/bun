// A number that a function of node:* checks against a range is passed or refused as lib/internal/validators.js of Node does it, also where the lower end of the range lies above the upper one:
// no number is inside such a range. ./numbers-checked-against-ranges/as-node-checks.cjs holds what Node does.
import { exposedInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";

const asNode = require("./numbers-checked-against-ranges/as-node-checks.cjs");
const validators = exposedInternals["internal/validators"];
const program = join(import.meta.dir, "numbers-checked-against-ranges", "main.cjs");
const everyCallAsInNode = "1134 calls\n";

test("every number against every range", () => {
  const ends: (number | undefined)[] = [
    undefined, -Infinity, -(2 ** 53), Number.MIN_SAFE_INTEGER, -(2 ** 31) - 1, -(2 ** 31), -1, -0.5, -0,
    0, 0.5, 1, 5, 2 ** 31 - 1, 2 ** 31, 2 ** 32, 2 ** 52, Number.MAX_SAFE_INTEGER, 2 ** 53, 2 ** 54 - 2, Infinity, NaN,
  ]; // prettier-ignore
  const otherwise: string[] = [];
  const check = (name: string, value: number, ...operands: unknown[]) => {
    const answer = asNode.answerOf(() => validators[name](value, "n", ...operands), "n");
    const expected = asNode[name](value, ...operands);
    if (answer !== expected)
      otherwise.push(`${name}(${[value, ...operands].map(asNode.show).join(", ")}): ${answer}, in Node: ${expected}`);
  };
  for (const value of asNode.numbers) {
    for (const min of ends)
      for (const max of ends)
        for (const name of ["validateInteger", "validateInt32", "validateNumber"]) check(name, value, min, max);
    for (const positive of [undefined, false, true]) check("validateUint32", value, positive);
  }
  expect(otherwise).toEqual([]);
});

test("the functions of node:* that check a number", async () => {
  const plain = await run([bunExe(), "run", program], undefined, bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: everyCallAsInNode, exitCode: 0 });
});

test.skipIf(!!unsupported)(
  "the functions of node:* that check a number, in an executable",
  async () => {
    using dir = tempDir("aot-numbers-checked-against-ranges", {});
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", program, "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const compiled = await run([executable], String(dir), bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      stdout: everyCallAsInNode,
      exitCode: 0,
    });
  },
  240_000,
);
