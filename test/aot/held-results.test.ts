// Compiled code takes the type that a `.bind.ts` file declares for a result as proven. So where compiled code runs, the thunk stops a program whose
// native code answers outside that type. Release `bun run` is held to nothing and answers as it always has.
// `declaredAsString` is declared as a string and answers with what it is given.
import { bindgen } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = `import { declaredResults } from "bun:internal-for-testing";

function ask(value: unknown): string {
  try {
    return typeof declaredResults.declaredAsString(value);
  } catch (error) {
    return String(error);
  }
}

console.log(declaredResults.holdsResultsToDeclaredTypes() ? "held" : "not held");
for (const value of ["text", 5, new String("text"), undefined]) console.log(ask(value));
`;

const stop =
  "TypeError: internal AOT error: type check failed: expected string in the result of DeclaredResultsTesting.declaredAsString. This is a bug in Bun, not in your code.";
const held = ["held", "string", stop, stop, stop];
const notHeld = ["not held", "string", "number", "object", "undefined"];
const env = { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" };

async function linesOf(cmd: string[], cwd: string) {
  const { stdout, exitCode } = await run(cmd, cwd, env);
  return { lines: stdout.trimEnd().split("\n"), exitCode };
}

test("an executable compiled ahead of time stops at an answer outside the declared type", async () => {
  using dir = tempDir("aot-held-results", { "app.ts": program });
  const cwd = String(dir);
  const built = await run([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], cwd, env);
  expect(built.stderr).not.toMatch(/^error\b/m);
  expect(built.exitCode).toBe(0);
  expect(await linesOf([join(cwd, isWindows ? "app.exe" : "app")], cwd)).toEqual({ lines: held, exitCode: 0 });
});

test("plain Bun lets the answer through, but for a build that asserts", async () => {
  using dir = tempDir("aot-held-results", { "app.ts": program });
  const { lines, exitCode } = await linesOf([bunExe(), "app.ts"], String(dir));
  // `bindgen` is there in a build with assertions, which holds results if it is a canary as well.
  if (isDebug || isASAN) expect(lines).toEqual(held);
  else if (!bindgen) expect(lines).toEqual(notHeld);
  else expect([held, notHeld]).toContainEqual(lines);
  expect(exitCode).toBe(0);
});
