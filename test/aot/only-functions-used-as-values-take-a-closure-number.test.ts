// A closure has 22 bits for the number of its function. Every function of a program used to take one of those numbers, and so
// did the copies and entry points that the compiler makes, several for each function written: 18,323 test files in one
// build needed 4.6 million and the build stopped. Now only a function that is used as a value takes one. No test program is
// that large, so the limit is lowered below the number of functions that the program below has.
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { unsupported } from "./harness/compiler";
import { describe, test } from "./harness/declare";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";

const calledByName = 600;
const usedAsValues = 20;

const lines: string[] = [];
for (let i = 0; i < calledByName; i++)
  lines.push(`function step${i}(x: number): number { return (x * 31 + ${i}) | 0; }`);
lines.push(`let sum = 0;`);
for (let i = 0; i < calledByName; i++) lines.push(`sum = step${i}(sum);`);
lines.push(
  `const values: Array<(x: number) => number> = [${Array.from({ length: usedAsValues }, (_, i) => `x => x + ${i}`).join(", ")}];`,
  `for (const value of values) sum = value(sum);`,
  `console.log(sum, values.map(value => value.length).join(""), new Set(values).size);`,
);

describe.skipIf(!!unsupported)("only functions used as values take a closure number", () => {
  const { folder, build, tryBuild } = sharedBuilds("only-functions-used-as-values-take-a-closure-number", {
    "main.ts": lines.join("\n") + "\n",
  });

  test("a program with more functions than closure numbers builds and prints what plain Bun prints", async () => {
    const built = await build("main.ts", "--aot", `--aot-limit=ImageClosureFunctions:${calledByName / 2}`);
    const printedBy = async (cmd: string[]) => {
      const { stdout, exitCode } = await run(cmd, folder, bunEnv);
      return { stdout, exitCode };
    };
    expect(await printedBy([built.executable])).toEqual(await printedBy([bunExe(), "main.ts"]));
  });

  test("a program with more functions used as values than closure numbers is refused by name", async () => {
    const built = await tryBuild("main.ts", "--aot", `--aot-limit=ImageClosureFunctions:${usedAsValues / 2}`);
    expect(built.stderr + built.stdout).toContain("TS100057");
    expect(built.stderr + built.stdout).toContain("functions in a program that are used as values");
    expect(built.exitCode).toBe(1);
  });
});
