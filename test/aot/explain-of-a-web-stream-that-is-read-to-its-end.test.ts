// A typed program makes a ReadableStream, puts two chunks into it and reads it to its end. Every callee is a method of a class of the platform.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import { parseExplainLines } from "./explain/explain-report";
import { run } from "./harness/run";
import { test } from "./supported";

const program = `const stream = new ReadableStream<string>({
  start(controller) {
    controller.enqueue("a");
    controller.enqueue("b");
    controller.close();
  },
});
const reader = stream.getReader();
let text = "";
for (;;) {
  const step = await reader.read();
  if (step.done) break;
  text += step.value;
}
console.log(text);
`;

// Today: enqueue, close, getReader and read are calls of a callee nobody knows (5 of 7 calls), and four accesses go by name.
test.todo(
  "the compiler knows what enqueue, close, getReader and read are",
  async () => {
    using dir = tempDirWithBunTypes("aot-explain-web-stream", { "main.ts": program });
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
