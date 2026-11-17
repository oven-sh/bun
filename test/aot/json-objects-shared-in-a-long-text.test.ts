// In a text over 64 KB JSON.stringify watches for an object inside itself. An object that sisters share is not inside itself:
// the engine's fast path writes the whole text. A true cycle leaves the fast path once and is refused.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const program = `class Row {
  constructor(public id: number, public head: Row | null) {}
}
function said(make: () => unknown): string {
  try {
    return String(JSON.stringify(make()).length);
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
const count: number = JSON.parse("12000");
const rowsOf = (make: (id: number) => unknown) => Array.from({ length: count }, (_, id) => make(id));
console.log(said(() => rowsOf(id => { const tags = ["a" + (id % 7), "b"]; return { id, tags, owner: { id: id + 1, tags }, notes: [{ tags }, { tags }] }; })));
console.log(said(() => rowsOf(id => { const first = new Row(id, null); return [first, new Row(id + 1, first)]; })));
console.log(said(() => rowsOf(id => { const first = new Row(id, null); return [first, new Row(id + 1, null), new Row(id + 2, first), new Row(id + 3, first)]; })));
console.log(said(() => { const rows = rowsOf(id => new Row(id, null)) as Row[]; for (const row of rows) row.head = row.id ? rows[0]! : null; return rows; }));
console.log(said(() => { const pairs = rowsOf(id => [new Row(id, null), new Row(id, null)]) as Row[][]; pairs[count - 1]![1]!.head = pairs[count - 1]![1]!; return pairs; }));
console.log(said(() => { const pairs = rowsOf(id => [new Row(id, null), new Row(id, null)]) as Row[][]; pairs[count - 1]![0]!.head = pairs[count - 1]![1]!; pairs[count - 1]![1]!.head = pairs[count - 1]![0]!; return pairs; }));
`;

describe("compile/aot/json-objects-shared-in-a-long-text", () => {
  test("only a true cycle leaves the fast path", async () => {
    using dir = tempDir("aot-json-objects-shared-in-a-long-text", { "main.ts": program });
    const cwd = String(dir);
    built(
      await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", join(cwd, "main")], cwd, bunEnv),
    );
    const counts = join(cwd, "counts");
    const ran = await spawned(["./main"], cwd, { ...bunEnv, BUN_JSC_aotCountsPath: counts });
    expect(ran).toEqual({
      stdout: "1417785\n830675\n1637365\n480875\nTypeError\nTypeError\n",
      stderr: "",
      exitCode: 0,
      signal: null,
    });
    const slowPaths = readFileSync(counts, "utf8")
      .split("\n")
      .map(line => line.split("\t"))
      .filter(([, name]) => name === "counter:JSONStringifySlowPaths")
      .map(([count]) => Number(count));
    expect(slowPaths).toEqual([2]);
  }, 120_000);
});
