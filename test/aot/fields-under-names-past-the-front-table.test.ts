// The front tables of the property caches have a column for 65,534 names, and an entry of the table of fields holds a name up to 65,535. A program
// that mentions more names leaves the rest without a column: their numbers are higher, and the run time finds them by other ways.
//
// Nobody chooses which names those are. The build orders the texts of a program by their hashes (src/aot/link/merge_strings.rs), the keys follow
// their texts, and the engine gives the columns to the first 65,534 keys that code mentions. So no case below stands on one name. Each asks under
// hundreds of names, the values differ from name to name, and what the program prints is wrong if one read goes under another name or finds nothing.
//
// The cases are one program, because each needs the other 65,534 names and the build of those is what costs:
//   literals.cjs           70,000 names, each a field of a literal
//   places.cjs             600 names, each read at six places in a loop
//   inherited-fields.cjs   8 times 32 names, each a default on a prototype object
//   late-fields.cjs        60 times two fields that stores make and one name that no object has, and then
//                          parallel/objects/first-store-creates-a-field.cjs
import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, limitWithASAN, spawned, told } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { compileCommand } from "./harness/flags";
import { beforeAll, describe, test } from "./supported";

const columnsOfTheFrontTables = 65_534;
const namesInLiterals = 70_000;
const namesInLiteral = 1_000;
const namesAtPlaces = 600;
// A parsed object that held all of them would be a dictionary. One of 40 is an ordinary object.
const namesInParsedObject = 40;
const setsOfDefaults = 8;
const defaultsInSet = 32;
const setsOfLateFields = 60;

const valueUnder = (index: number) => 1 + (index % 251);
function sumOfValues(first: number, end: number) {
  let sum = 0;
  for (let index = first; index < end; index++) sum += valueUnder(index);
  return sum;
}
const sets = (count: number, text: (set: number) => string) =>
  Array.from({ length: count }, (_, set) => text(set)).join("");

// Each name is read from a parsed object that lacks it, and from the literal that holds it as a field.
function fieldsOfLiterals() {
  const lines = [`let total = 0;`, `const unknown = JSON.parse(process.env.TEXT_NOBODY_SETS || '{"n5":1}');`];
  for (let first = 0; first < namesInLiterals; first += namesInLiteral) {
    const indexes = Array.from({ length: namesInLiteral }, (_, i) => first + i);
    lines.push(
      `const literal${first} = { ${indexes.map(i => `n${i}: ${valueUnder(i)}`).join(", ")} };`,
      `function hot${first}(o) { let s = 0; for (let i = 0; i < 2; i++) for (let j = 0; j < 1; j++) for (let k = 0; k < 1; k++) s += ${indexes.map(i => `(o.n${i} | 0)`).join(" + ")}; return s; }`,
      `total += hot${first}(unknown) + hot${first}(literal${first});`,
    );
  }
  lines.push(`console.log(total);`);
  return lines.join("\n") + "\n";
}
// Plain Bun has no such tables, so it does not run this file. The parsed object gives 1 in each of two turns, and each literal its values.
const printedByLiterals = [String(2 + 2 * sumOfValues(0, namesInLiterals))];

// A read that comes again has a place, and finds its name by the place where the place has no answer. The table of those names has two bytes for a
// place, which hold the number of a name with a column. The number of any other name stands behind a mark. Each name below is read at six places,
// from a parsed object that holds it.
function namesReadAtPlaces() {
  const lines = [`let total = 0;`];
  for (let first = namesInLiterals; first < namesInLiterals + namesAtPlaces; first += namesInParsedObject) {
    const indexes = Array.from({ length: namesInParsedObject }, (_, i) => first + i);
    const sum = indexes.map(i => `(o.n${i} | 0)`).join(" + ");
    const text = `{${indexes.map(i => `"n${i}":${valueUnder(i)}`).join(",")}}`;
    lines.push(
      `function places${first}(o) { let s = 0; for (let i = 0; i < 2; i++) { ${`s += ${sum}; `.repeat(6)}} return s; }`,
      `total += places${first}(JSON.parse(process.env.TEXT_NOBODY_SETS || '${text}'));`,
    );
  }
  lines.push(`console.log(total);`);
  return lines.join("\n") + "\n";
}
const printedByPlaces = [String(2 * 6 * sumOfValues(namesInLiterals, namesInLiterals + namesAtPlaces))];

// As @bufbuild/protobuf makes the options of a field: the defaults lie on a prototype object, and nobody knows what arrives at the read.
function inheritedFields(set: number) {
  const names = Array.from({ length: defaultsInSet }, (_, i) => `above${set}x${i}`);
  return `
function options${set}(init) {
  const proto = Object.create({ ${names.map((name, i) => `${name}: ${valueUnder(i)}`).join(", ")} });
  return Object.assign(proto, Object.assign({ name: "options" }, init));
}
function fields${set}(proto) {
  var _c;
  return (_c = proto.options) === null || _c === void 0 ? 0 : ${names.map(name => `(_c.${name} | 0)`).join(" + ")};
}
const parsed${set} = JSON.parse('{"options":{${names.map(name => `"${name}":3`).join(",")}}}');
const protos${set} = [{ options: options${set}({ a: 1 }) }, parsed${set}, { options: undefined }, { options: options${set}({ b: 2 }) }];
for (let turn = 0; turn < 400; turn++) sum += fields${set}(protos${set}[turn & 3]);
`;
}
// Of the 400 turns of a set, 200 read the defaults, 100 read the parsed object, which holds 3 under each name, and 100 find no options.
const printedByInheritedFields = [
  String(setsOfDefaults * (200 * sumOfValues(0, defaultsInSet) + 100 * 3 * defaultsInSet)),
];

// The stores of a constructor make two fields. The third name is on no object. The hash decides for these 120 names of fields as for all: it leaves
// about one name in twelve without a column, and the build does not say which. The same holds for the names of the stored program behind them.
const lateFields = (set: number) => `
function Point${set}(x, y) { this.late${set}X = x; this.late${set}Y = y; }
Point${set}.prototype.norm = function () { return this.late${set}X * this.late${set}X + this.late${set}Y * this.late${set}Y; };
const points${set} = [];
for (let i = 0; i < 40; i++) points${set}.push(new Point${set}(i, String(i)), new Point${set}(i + 0.5, null));
let read${set} = 0;
for (const point of points${set}) read${set} += point.late${set}X + (point.late${set}Y === null ? 1 : point.late${set}Y.length) + ("late${set}X" in point ? 1 : 0) + (point.late${set}Z === undefined ? 1 : 0);
console.log(read${set}, Object.keys(points${set}[0]).join(), points${set}[3].norm());
`;
const printedByLateFields = Array.from({ length: setsOfLateFields }, (_, set) => `1850 late${set}X,late${set}Y 2.25`);

let folder: Disposable | undefined;
let build: Awaited<ReturnType<typeof spawned>>;
let compiled: ReturnType<typeof told>;
let plain: ReturnType<typeof told>;
let printedByStoredProgram: string[];

beforeAll(async () => {
  const stored = readFileSync(join(import.meta.dir, "parallel", "objects", "first-store-creates-a-field.cjs"), "utf8");
  // The stored program ends with what it prints.
  const output = "/* Output:\n";
  printedByStoredProgram = stored
    .slice(stored.indexOf(output) + output.length, stored.lastIndexOf("*/"))
    .split("\n")
    .slice(0, -1);
  const late = sets(setsOfLateFields, lateFields) + stored;
  const dir = tempDir("aot-names-past-the-front-tables", {
    "literals.cjs": fieldsOfLiterals(),
    "places.cjs": namesReadAtPlaces(),
    "inherited-fields.cjs": `let sum = 0;\n${sets(setsOfDefaults, inheritedFields)}console.log(sum);\n`,
    "late-fields.cjs": late,
    // Some functions of the stored program start with "use strict", which plain Bun drops when it transpiles. A file with this first line is not transpiled.
    "late-fields-as-written.cjs": `// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {${late}\n})\n`,
    "program.cjs": `require("./literals.cjs");\nrequire("./places.cjs");\nrequire("./inherited-fields.cjs");\nrequire("./late-fields.cjs");\n`,
    "plain.cjs": `require("./places.cjs");\nrequire("./inherited-fields.cjs");\nrequire("./late-fields-as-written.cjs");\n`,
  });
  folder = dir;
  const executable = join(String(dir), isWindows ? "program.exe" : "program");
  const [builtProgram, plainRun] = await Promise.all([
    spawned(
      [bunExe(), ...compileCommand, "--explain=statistics", "./program.cjs", "--outfile", executable],
      String(dir),
      bunEnv,
      // With a sanitizer a debug Bun needs about 100 s for this build. Without one, spawned() would give it the 90 s of a release build.
      isDebug ? limitWithASAN : undefined,
    ),
    spawned([bunExe(), "./plain.cjs"], String(dir), bunEnv),
  ]);
  build = builtProgram;
  built(build);
  plain = told(plainRun);
  compiled = told(await spawned([executable], String(dir), bunEnv));
});
afterAll(() => folder?.[Symbol.dispose]());

/** The lines of a run from `first` up to `end`, and how the run ended. */
const linesOf = (run: ReturnType<typeof told>, first: number, end: number) => ({
  stdout: run.stdout.split("\n").slice(first, end),
  stderr: run.stderr,
  exitCode: run.exitCode,
});
const printed = (stdout: string[]) => ({ stdout, stderr: "", exitCode: 0 });

describe("a program that mentions more names than the front tables have columns", () => {
  test("leaves thousands of them without a column", () => {
    // literals.cjs and places.cjs alone mention 70,600 names.
    expect(Number(/^NamesWithoutColumn (\d+)$/m.exec(build.stderr)?.[1])).toBeGreaterThanOrEqual(
      namesInLiterals + namesAtPlaces - columnsOfTheFrontTables,
    );
  });
});

describe("a field under a name that the table of fields has no number for", () => {
  test("is read from the literal that holds it", () => {
    expect(linesOf(compiled, 0, 1)).toEqual(printed(printedByLiterals));
  });

  test("is read from the prototype object that holds it", () => {
    expect(linesOf(compiled, 2, 3)).toEqual(printed(printedByInheritedFields));
    expect(linesOf(plain, 1, 2)).toEqual(printed(printedByInheritedFields));
  });
});

describe("a place under a name whose number does not fit two bytes", () => {
  test("goes on under that name", () => {
    expect(linesOf(compiled, 1, 2)).toEqual(printed(printedByPlaces));
    expect(linesOf(plain, 0, 1)).toEqual(printed(printedByPlaces));
  });
});

describe("fields under names that have no column in the front table", () => {
  test("answer as under plain Bun", () => {
    // The last line of a run ends with a line feed.
    expect(linesOf(compiled, 3, -1)).toEqual(printed([...printedByLateFields, ...printedByStoredProgram]));
    expect(linesOf(plain, 2, -1)).toEqual(printed([...printedByLateFields, ...printedByStoredProgram]));
  });
});
