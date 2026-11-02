// The compiler follows every value of a program from where it is made to where it is used. What stands behind an operation for which it finds no value is unreachable to it.
// That is right where the operation never completes: a call of what always throws or is no function, a read from null. The compiler knows those reasons.
// Where every operand of an operation has a value, its result has none and no such reason holds, a value has been lost. Every build stops there, a user's as well as one of
// these tests, which also verify the program between the stages of the compiler: an internal error that names the operation, the function, the file and the line.
//
// `--aot-sabotage=StoredValuesAreNeverRead` (hidden) loses values on purpose: a read no longer finds what was stored.
// parallel/errors/operations-that-never-complete.ts has the operations that have a reason.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned, unsupported } from "./harness/commands";
import { registry } from "./harness/registry";
import { describe, test } from "./supported";

const losesValues = "--aot-sabotage=StoredValuesAreNeverRead";

const stopped: Record<string, { source: string; place: string }> = {
  "a read of a field in a function": {
    source: `
type Pair = { left: number; right: string };
function leftOf(pair: Pair): number {
  const left = pair.left;
  return left + 1;
}
console.log(leftOf({ left: 1, right: "two" }));`,
    place: String.raw`\(PropGet\) in function 'leftOf' at .*main\.ts:4:\d+`,
  },
};

const { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: _, ...asUsersHaveIt } = bunEnv;
const environments = { "a build of these tests": bunEnv, "a user's build": asUsersHaveIt };
type Builder = keyof typeof environments;

async function build(builder: Builder, source: string, ...flags: string[]) {
  using folder = tempDir("aot-an-operation-without-a-value", { "main.ts": source });
  const executable = join(String(folder), isWindows ? "main.exe" : "main");
  const result = await slot(() =>
    spawned(
      [bunExe(), "build", "--compile", "--aot", ...flags, "./main.ts", "--outfile", executable],
      String(folder),
      environments[builder],
    ),
  );
  return { exitCode: result.exitCode, stderr: result.stderr, isThere: existsSync(executable) };
}

const both = <T>(names: T[]) =>
  (Object.keys(environments) as Builder[]).flatMap(builder => names.map(name => [builder, name] as const));

const hasTheWord = !unsupported && registry().sabotages?.includes("StoredValuesAreNeverRead");

describe.skipIf(!hasTheWord)("compile/aot/an operation without a value stops the build", () => {
  test.concurrent.each(both(Object.keys(stopped)))("in %s it is named: %s", async (builder, name) => {
    const { source, place } = stopped[name];
    const result = await build(builder, source, losesValues);
    expect(result.stderr).toMatch(
      new RegExp(`internal compiler error \\(AnalyzeFlow\\): OperationWithoutValue: .*${place}`),
    );
    expect(result.stderr).toContain("This is a bug in Bun. Please report it");
    expect({ exitCode: result.exitCode, isThere: result.isThere }).toEqual({ exitCode: 1, isThere: false });
  });
});
