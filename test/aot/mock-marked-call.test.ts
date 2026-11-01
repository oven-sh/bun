import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A mock rises above the imports of its file. Plain Bun's parser has erased the type syntax by the time it looks for the call: a mark on `vi`, on the method or on the path hides nothing.
const factory = `() => ({ name: "mocked" })`;
const calls: Record<string, string> = {
  "vi as any": `(vi as any).mock("./dep", ${factory});`,
  "vi, not null": `vi!.mock("./dep", ${factory});`,
  "vi under two marks": `(vi as unknown as typeof vi).mock("./dep", ${factory});`,
  "vi satisfies": `(vi satisfies typeof vi).mock("./dep", ${factory});`,
  "jest as any": `(jest as any).mock("./dep", ${factory});`,
  "the method, not null": `vi.mock!("./dep", ${factory});`,
  "the method as any": `(vi.mock as any)("./dep", ${factory});`,
  "a chain of jest": `(jest as any).mock("./dep", ${factory}).mock("./other", () => ({}));`,
  "the path as an import with a mark": `vi.mock(import("./dep") as any, ${factory});`,
  "the path as an awaited import with marks": `vi.mock((await (import("./dep") as any)) as any, ${factory});`,
  "the call as any": `vi.mock("./dep", ${factory}) as any;`,
  "no mark": `vi.mock("./dep", ${factory});`,
  "another object under a mark rises nowhere": `({ mock() {} } as any).mock("./dep", ${factory});`,
};

test.each(Object.keys(calls))(
  "%s: as plain Bun, as one program and in two layers",
  async name => {
    using dir = tempDir("aot-mock-marked-call", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "dep.ts": `export const name = "real";`,
      "other.ts": `export {};`,
      "uses-dep.ts": `import { name } from "./dep"; export const seen = name;`,
      "a.test.ts": `import { test, vi, jest } from "bun:test";
import { seen } from "./uses-dep";
${calls[name]}
test("t", () => console.log("SEEN", seen));`,
    });
    const seen = async (flags: string[], words: string) => {
      const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words }); // prettier-ignore
      const lines = (stdout + "\n" + stderr).split("\n");
      return lines.filter(line => line.startsWith("SEEN") || /^warn: TS\d+/.test(line) || /^(\w*Error): /.test(line));
    };
    const plain = await seen([], "");
    expect(plain.length).toBeGreaterThan(0);
    expect(await seen(["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await seen(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  },
  600000,
);
