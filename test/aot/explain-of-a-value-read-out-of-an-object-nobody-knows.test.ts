// What `bun check --aot --explain` says of a value that is read out of an object nobody knows.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import type { ExplainCause } from "./explain/explain-report";
import { parseExplainLines } from "./explain/explain-report";
import { run } from "./harness/run";
import { describe, test } from "./supported";

async function explain(files: Record<string, string>) {
  using dir = tempDirWithBunTypes("aot-explain-nearest-cause", files);
  const { stdout, exitCode } = await run(
    [bunExe(), "check", "--aot", "--no-pretty", "--explain=json", "main.ts"],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  return { causes: parseExplainLines(stdout).causes, exitCode };
}

const placeOf = ({ file, line, column, reason }: ExplainCause) => `${file}:${line}:${column} ${reason}`;

describe.concurrent("a function that only code outside the program calls", () => {
  test("what is read out of its parameter is read from a shared object: no built-in function has answered it", async () => {
    const { causes, exitCode } = await explain({
      "main.ts": `function handle(context: any) {
  return context.request.method;
}
(globalThis as any)[process.argv[2] ?? "handler"] = handle;
console.log((globalThis as any).handler({ request: { method: "GET" } }));
`,
    });
    expect({ inHandle: causes.filter(cause => cause.line === 2).map(placeOf), exitCode }).toEqual({
      inHandle: ["main.ts:2:10 called-by-unknown-code", "main.ts:2:18 read-from-shared-object"],
      exitCode: 0,
    });
  }, 60_000);
});
