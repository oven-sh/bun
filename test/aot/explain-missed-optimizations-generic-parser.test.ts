// `JSON.parse(text) as T` is parsed by code compiled for T. --explain=missed-optimizations lists the parts of T that the generic parser builds instead.
// A record with array members has no such part. A union that could try two recursive arms has one, and the report says why.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

async function findGenericParserLines(folder: string): Promise<string[]> {
  const { stderr, exitCode } = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--explain=missed-optimizations",
      "main.ts",
      "--outfile",
      join(folder, "main" + (isWindows ? ".exe" : "")),
    ],
    folder,
  );
  expect(stderr).toContain("missed optimizations: ");
  expect(exitCode).toBe(0);
  return stderr.split("\n").filter(line => line.includes("generic-parser"));
}

test("a record with array members is parsed by compiled code", async () => {
  using dir = tempDir("aot-parsed-array-members", {
    "main.ts": `
type Row = { id: number };
type Page = { items: Row[]; total: number };
const page = JSON.parse('{"items":[{"id":3},{"id":4}],"total":2}') as Page;
let sum = 0;
for (const row of page.items) sum += row.id;
console.log(sum, page.total);
`,
  });
  expect(await findGenericParserLines(String(dir))).toEqual([]);
}, 120_000);

test("a union with two recursive members is reported with its cause", async () => {
  using dir = tempDir("aot-parsed-recursive-union", {
    "main.ts": `
interface Left { left?: Tree } interface Right { right?: Tree }
type Tree = Left | Right;
console.log(JSON.stringify(JSON.parse('{"tree":{"left":{"right":{}}}}') as { tree: Tree }));
`,
  });
  const lines = await findGenericParserLines(String(dir));
  expect(lines.filter(line => line.includes("missed: ")).map(line => line.replace(/^.*missed: /, ""))).toEqual([
    expect.stringMatching(/^generic-parser at main\.ts:\d+:\d+, two members of a union are both recursive$/),
  ]);
}, 120_000);
