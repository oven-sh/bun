// A program makes an object of a class of the platform and calls a method of it that keeps the receiver. Nothing changes the class or the object.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import { parseExplainLines } from "./explain/explain-report";
import { run } from "./harness/run";
import { test } from "./supported";

const programs = {
  "AbortController.prototype.abort": `const controller = new AbortController();\ncontroller.abort("x");\n`,
  "WritableStream.prototype.getWriter": `const writable = new WritableStream<string>();\nwritable.getWriter();\n`,
};

// Today: the flow analysis names the callee, and the call is still one of a callee nobody knows behind a read by name.
for (const [callee, program] of Object.entries(programs)) {
  test.todo(
    `the compiler knows that the callee is ${callee}`,
    async () => {
      using dir = tempDirWithBunTypes("aot-explain-kept-receiver", { "main.ts": program });
      const { stdout, exitCode } = await run(
        [bunExe(), "check", "--aot", "--no-pretty", "--explain=json", "main.ts"],
        String(dir),
        { ...bunEnv, NO_COLOR: "1" },
      );
      const { calls, accesses } = parseExplainLines(stdout).numbers;
      expect({ unknownCalls: calls.unknown, accessesByName: accesses.byName, exitCode }).toEqual({
        unknownCalls: 0,
        accessesByName: 0,
        exitCode: 0,
      });
    },
    60_000,
  );
}
