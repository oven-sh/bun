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
    // The store may be a store to `onmessage`, whose handler the host calls. With a written key in line 4 no such cause is left, and without the call in line 5 this one stays.
    // The order of the causes follows how often the compiler expects each line to run, which is not what is asked here. Nor is a cause that no access hangs on.
    const ofUnknownCode = causes.filter(cause => cause.reason === "called-by-unknown-code" && cause.accesses > 0);
    expect({
      inHandle: causes.filter(cause => cause.line === 2).map(placeOf),
      ofUnknownCode: ofUnknownCode.map(placeOf),
      exitCode,
    }).toEqual({
      inHandle: [],
      ofUnknownCode: ["main.ts:4:2 called-by-unknown-code"],
      exitCode: 0,
    });
    expect(ofUnknownCode[0].accesses).toBeGreaterThanOrEqual(2);
  }, 60_000);

  test("points at the access, not at the function's declaration, where a global may hold the function", async () => {
    const { causes } = await explain({
      "main.ts": `function handle(context: any) {
  return context.request.method;
}
(globalThis as any)[process.argv[2] ?? "handler"] = handle;
console.log((globalThis as any).handler({ request: { method: "GET" } }));
`,
    });
    const ofBuiltinObjects = causes.filter(cause => cause.reason === "not-a-plain-object");
    expect(ofBuiltinObjects.map(placeOf)).toContain("main.ts:4:2 not-a-plain-object");
    expect(ofBuiltinObjects.filter(cause => cause.line === 1).map(placeOf)).toEqual([]);
  }, 60_000);
});
