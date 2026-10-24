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
  test("what is read out of its parameter hangs on the line that lets such code in, not on the reads: no built-in function has answered it", async () => {
    const { causes, exitCode } = await explain({
      "main.ts": `function handle(context: any) {
  return context.request.method;
}
(globalThis as any)[process.argv[2] ?? "handler"] = handle;
console.log((globalThis as any).handler({ request: { method: "GET" } }));
`,
    });
    expect({
      inHandle: causes.filter(cause => cause.line === 2).map(placeOf),
      first: placeOf(causes[0]),
      exitCode,
    }).toEqual({
      inHandle: [],
      first: "main.ts:5:14 called-by-unknown-code",
      exitCode: 0,
    });
    expect(causes[0].accesses).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
