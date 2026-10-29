// The front table of the property caches has a column for 32,767 names. A large program names more, and the coldest names get none.
// The table of fields takes twice as many, so reads and stores of fields under such names still stay in their stubs.
//
// The program below reads 36,000 names in loops, which takes every column, and then runs the stores, definitions and reads of
// parallel/objects/first-store-creates-a-field.cjs, whose names are all colder.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned, told } from "./harness/commands";
import { describe, test } from "./supported";

const hotNames = 36_000;
const namesInFunction = 1_000;

function hotReads() {
  const lines = [`let total = 0;`, `const unknown = JSON.parse('{"n5":1}');`];
  for (let first = 0; first < hotNames; first += namesInFunction) {
    const sum = Array.from({ length: namesInFunction }, (_, i) => `(o.n${first + i} | 0)`).join(" + ");
    lines.push(
      `function hot${first}(o) { let s = 0; for (let i = 0; i < 2; i++) s += ${sum}; return s; }`,
      `total += hot${first}(unknown);`,
    );
  }
  lines.push(`console.log(total);`);
  return lines.join("\n") + "\n";
}

const lateFields = `
function Point(x, y) { this.coldX = x; this.coldY = y; }
Point.prototype.norm = function () { return this.coldX * this.coldX + this.coldY * this.coldY; };
const points = [];
for (let i = 0; i < 40; i++) points.push(new Point(i, String(i)), new Point(i + 0.5, null));
let read = 0;
for (const point of points) read += point.coldX + (point.coldY === null ? 1 : point.coldY.length) + ("coldX" in point ? 1 : 0) + (point.coldZ === undefined ? 1 : 0);
console.log(read, Object.keys(points[0]).join(), points[3].norm());
`;

describe("fields under names that have no column in the front table", () => {
  test("answer as under plain Bun and stay in their stubs", async () => {
    const hostile = readFileSync(
      join(import.meta.dir, "parallel", "objects", "first-store-creates-a-field.cjs"),
      "utf8",
    );
    using dir = tempDir("aot-names-past-the-front-table", { "program.cjs": hotReads() + lateFields + hostile });
    const folder = String(dir);
    const executable = join(folder, isWindows ? "program.exe" : "program");
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", "./program.cjs", "--outfile", executable],
        folder,
        bunEnv,
      ),
    );
    const expected = told(await spawned([bunExe(), "./program.cjs"], folder, bunEnv));
    expect(told(await spawned([executable], folder, bunEnv))).toEqual(expected);
    expect(told(await spawned([executable], folder, { ...bunEnv, BUN_JSC_validateAOTRuntime: "1" }))).toEqual(expected);

    const counts = join(folder, "counts.txt");
    told(await spawned([executable], folder, { ...bunEnv, BUN_JSC_aotCountsPath: counts }));
    const withoutColumn = readFileSync(counts, "utf8")
      .split("\n")
      .filter(line => line.includes("the name has no column"));
    expect(withoutColumn).toEqual([]);
  }, 240_000);
});
