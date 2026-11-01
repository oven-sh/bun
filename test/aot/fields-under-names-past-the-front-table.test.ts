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

// An entry of the table of fields holds a name up to 65,535. A program that looks up more names numbers the rest higher, in the order of its files,
// and a file comes behind what it requires. So the first file below takes every number up to there, and the names of the second are higher.
const namesPastTheTableOfFields = 66_000;

function manyNamesLookedUp() {
  const lines = [`let total = 0;`, `const unknown = JSON.parse(process.env.TEXT_NOBODY_SETS || '{"n5":1}');`];
  for (let first = 0; first < namesPastTheTableOfFields; first += namesInFunction) {
    const names = Array.from({ length: namesInFunction }, (_, i) => `n${first + i}`);
    lines.push(
      `const literal${first} = { ${names.map(name => `${name}: 0`).join(", ")} };`,
      `function hot${first}(o) { let s = 0; for (let i = 0; i < 2; i++) for (let j = 0; j < 1; j++) for (let k = 0; k < 1; k++) s += ${names.map(name => `(o.${name} | 0)`).join(" + ")}; return s; }`,
      `total += hot${first}(unknown) + hot${first}(literal${first});`,
    );
  }
  lines.push(`console.log(total);`);
  return lines.join("\n") + "\n";
}

// As @bufbuild/protobuf makes the options of a field: the defaults lie on a prototype object, and nobody knows what arrives at the read.
const inheritedField = `
function options(init) {
  const proto = Object.create({ coldKind: 0, coldPacked: false, coldType: 7 });
  return Object.assign(proto, Object.assign({ name: "options" }, init));
}
function field(proto) {
  var _c;
  return (_c = proto.options) === null || _c === void 0 ? void 0 : _c.coldType;
}
const parsed = JSON.parse('{"options":{"coldType":3}}');
const protos = [{ options: options({ a: 1 }) }, parsed, { options: undefined }, { options: options({ b: 2 }) }];
let sum = 0;
for (let turn = 0; turn < 400; turn++) sum += field(protos[turn & 3]) | 0;
console.log(sum);
`;

describe("a field under a name that the table of fields has no number for", () => {
  test("is read from the prototype object that holds it", async () => {
    using dir = tempDir("aot-names-past-the-table-of-fields", {
      "many-names.cjs": manyNamesLookedUp(),
      "inherited-field.cjs": inheritedField,
      "program.cjs": `require("./many-names.cjs");\nrequire("./inherited-field.cjs");\n`,
    });
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
  }, 240_000);
});

describe("fields under names that have no column in the front table", () => {
  test("answer as under plain Bun and stay in their stubs", async () => {
    const hostile = readFileSync(
      join(import.meta.dir, "parallel", "objects", "first-store-creates-a-field.cjs"),
      "utf8",
    );
    const text = hotReads() + lateFields + hostile;
    // Some of its functions start with "use strict", which plain Bun drops when it transpiles. A file with this first line is not transpiled.
    const asWritten = `// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {${text}\n})\n`;
    using dir = tempDir("aot-names-past-the-front-table", { "program.cjs": text, "as-written.cjs": asWritten });
    const folder = String(dir);
    const executable = join(folder, isWindows ? "program.exe" : "program");
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", "./program.cjs", "--outfile", executable],
        folder,
        bunEnv,
      ),
    );
    const expected = told(await spawned([bunExe(), "./as-written.cjs"], folder, bunEnv));
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
