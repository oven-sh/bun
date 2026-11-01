import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `const a = "a"` is hoisted with the mocks, so that their factories can read it. Plain Bun's parser has erased the type syntax by then: a literal with a mark on it is a literal.
const file = (declarations: string, read: string) => `import { test, vi } from "bun:test";
${declarations}
vi.mock("./dep", () => ({ name: ${read} }));
import { name } from "./dep";
test("t", () => console.log("SEEN", name));`;
const files: Record<string, string> = {
  "as const": file(`const NAME = "mocked" as const;`, "NAME"),
  "as a type": file(`const NAME = "mocked" as string;`, "NAME"),
  "satisfies": file(`const NAME = "mocked" satisfies string;`, "NAME"),
  "in angle brackets": file(`const NAME = <string>"mocked";`, "NAME"),
  "not null": file(`const NAME = "mocked"!;`, "NAME"),
  "two marks": file(`const NAME = ("mocked" as const) satisfies string;`, "NAME"),
  "numbers": file(
    `const A = 5 as number, B = -1 as const, C = -(2 as number), D = -3n as bigint;`,
    "[A, B, C, String(D)].join()",
  ),
  "other literals": file(
    "const A = true as boolean, B = null as null, C = undefined as undefined, D = `text` as const;",
    "[A, B, C, D].join()",
  ),
  "no mark": file(`const NAME = "mocked";`, "NAME"),
  "a call with a mark is no literal": file(
    `const NAME = String("late") as string;`,
    `(() => { try { return NAME; } catch (e) { return (e as Error).name; } })()`,
  ),
};

test.each(Object.keys(files))(
  "%s: as plain Bun, as one program and in two layers",
  async name => {
    using dir = tempDir("aot-mock-marked-literal", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "dep.ts": `export const name = "real";`,
      "a.test.ts": files[name],
    });
    const seen = async (flags: string[], words: string) => {
      const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words }); // prettier-ignore
      const lines = (stdout + "\n" + stderr).split("\n");
      return lines.filter(line => line.startsWith("SEEN") || /^warn: TS\d+/.test(line));
    };
    const plain = await seen([], "");
    expect(plain.length).toBeGreaterThan(0);
    expect(await seen(["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await seen(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  },
  600000,
);
