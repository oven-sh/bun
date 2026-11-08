// Where the code that makes process.stdout or process.stderr throws, `bun run` reports the error as one that nobody caught, and the
// property is undefined from then on. An executable that holds the streams without most of their members does the same.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

const readsWhereTheStackIsFull = (stream: string) => `let answer = "never";
function dive() {
  try {
    dive();
  } catch {
    if (answer !== "never") return;
    try {
      answer = "the read answers " + typeof process.${stream};
    } catch (error) {
      answer = "the read throws " + (error instanceof RangeError);
    }
  }
}
dive();
console.log(answer);
console.log("later " + typeof process.${stream});
`;

async function ran(cmd: string[], cwd: string) {
  const { stdout, stderr, exitCode } = await spawned(cmd, cwd, env);
  return { stdout, reported: stderr.split("\n").filter(line => line.startsWith("RangeError")), exitCode };
}

describe("the stack is full where a standard stream is first read", () => {
  for (const stream of ["stdout", "stderr"]) {
    test(
      `process.${stream}`,
      () =>
        slot(async () => {
          using dir = tempDir("aot-error-while-a-stream-is-made", { "app.ts": readsWhereTheStackIsFull(stream) });
          const folder = String(dir);
          built(await spawned([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], folder, env));
          const compiled = await ran([join(folder, "app")], folder);
          expect(compiled).toEqual({
            stdout: "the read answers undefined\nlater undefined\n",
            reported: ["RangeError: Maximum call stack size exceeded."],
            exitCode: 1,
          });
          expect(compiled).toEqual(await ran([bunExe(), "app.ts"], folder));
        }),
      300_000,
    );
  }
});
