// A field that is read again: what happened to the objects, times the test between the reads, times how the field is read, times what stands between, times which objects come and where from.
//
//   bun write-field-again-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<object>--<test>--<read>--<between>--<company>.ts or .mjs
//   bun write-field-again-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `row` is the object that something has happened to.
const objects: [name: string, text: string][] = [
  ["last-deleted", "const row = new Row(5);\ndelete row.lid;"],
  ["first-deleted", "const row = new Row(5);\ndelete row.size;"],
  ["deleted-and-back", "const row = new Row(5);\ndelete row.size;\nrow.size = 6;"],
  ["both-deleted", "const row = new Row(5);\ndelete row.size;\ndelete row.lid;"],
  ["added", "const row = new Row(5);\nrow.more = 1;"],
  ["many-added", 'const row = new Row(5);\nfor (let i = 0; i < 70; i++) row["m" + i] = i;'],
  ["text-in-it", 'const row = new Row(5);\nrow.size = "t";'],
  ["nothing-in-it", "const row = new Row(5);\nrow.size = undefined;"],
  ["object-in-it", "const row = new Row(5);\nrow.size = { v: 1 };"],
  ["frozen", "const row = Object.freeze(new Row(5));"],
  ["getter", 'const row = new Row(5);\nlet asked = 0;\nObject.defineProperty(row, "size", { get: () => asked++ });'],
  ["of-prototype", "const row = Object.create(new Row(5));"],
  ["prototype-changed", "const row = new Row(5);\nObject.setPrototypeOf(row, { deep: 1 });"],
  ["literal", "const row = { size: 5, lid: 5 };"],
  ["other-order", "const row = { lid: 4, size: 5 };"],
  ["heir", "const row = new Heir(5);"],
  ["assigned", "const row = Object.assign(new Row(5), { size: 8, z: 1 });"],
  ["spread", "const row = { ...new Row(5), size: 9 };"],
  ["by-key", 'const row = new Row(5);\nrow[["si", "ze"].join("")] = 0.5;'],
  ["proxy", "const row = new Proxy(new Row(5), {});"],
  ["none", "const row = new Row(5);"],
];
// `T` is true or false by the value.
const tests: [name: string, text: string][] = [
  ["no-number", 'typeof value !== "number"'],
  ["object", 'typeof value === "object"'],
  ["not-null", "value != null"],
  ["truth", "value"],
  ["class", "value instanceof Row"],
  ["no-other", "!(value instanceof Other)"],
  ["has", 'Object(value) === value && "size" in value'],
  ["size-number", 'typeof value?.size === "number"'],
  ["size-there", "value?.size !== undefined"],
  ["size-large", "value?.size > 2"],
  ["flag", "turn & 1"],
  ["always", "true"],
  ["parsed", 'JSON.parse("true")'],
  ["list", "!Array.isArray(value)"],
];
// `R` is the read.
const reads: [name: string, text: string][] = [
  ["field", "value.size"],
  ["maybe", "value?.size"],
  ["two", "value.size + value.lid"],
  ["key", "value[name]"],
  ["integer", "value.size | 0"],
  ["text", "`${value.size}`"],
  ["own-read", "read(value)"],
  ["pattern", "(({ size }) => size)(value)"],
  ["deep", "value.size?.v"],
  ["last", "value.lid"],
];
// `TEST` and `READ`; what is read goes into `out`.
const shapes: [name: string, text: string][] = [
  ["before-in-behind", "out.push(READ);\nif (TEST) out.push(READ);\nout.push(READ);"],
  ["in-behind", "if (TEST) out.push(READ);\nout.push(READ);"],
  ["else", "out.push(READ);\nif (TEST) out.push(READ);\nelse out.push(-1);\nout.push(READ);"],
  ["two-tests", 'if (TEST) out.push(READ);\nif (typeof value !== "number") out.push(READ);\nout.push(READ);'],
  ["text", 'let text = "/" + READ;\nif (TEST) text += "/" + READ;\ntext += READ;\nout.push(text);'],
  ["sum", "let sum = 0;\nsum += READ;\nif (TEST) sum += READ;\nsum += READ;\nout.push(sum);"],
  ["loop", "for (let k = 0; k < 3; k++) {\n  if (TEST) out.push(READ);\n  out.push(READ);\n}"],
  ["early", "if (!(TEST)) return out.push(READ);\nout.push(READ);\nout.push(READ);"],
  ["chosen", "out.push(TEST ? READ : -1);\nout.push(READ);"],
  ["tried", "try {\n  out.push(READ);\n} catch {\n  out.push(-2);\n}\nif (TEST) out.push(READ);\nout.push(READ);"],
  ["written-between", "out.push(READ);\nif (TEST) value.size = 7;\nout.push(READ);"],
  ["deleted-between", "out.push(READ);\nif (TEST) delete value.size;\nout.push(READ);"],
  ["called-between", "out.push(READ);\nif (TEST) touch(value);\nout.push(READ);"],
  ["while", "let k = 0;\nwhile (k++ < 2) {\n  out.push(READ);\n  if (TEST) continue;\n  out.push(READ);\n}"],
];
// `ROW` is the object, the others come before and behind it.
const companies: [name: string, text: string][] = [
  ["mixed", "[new Row(1), new Other(2), new Third(3), ROW, 4]"],
  ["rows", "[new Row(1), ROW, new Row(2)]"],
  ["row-number", "[new Row(1), ROW, 4]"],
  ["row-nothing", "[new Row(1), ROW, {}]"],
  ["first", "[ROW, new Other(1), 4]"],
  ["literals", "[{ size: 1 }, { size: 0.5, lid: 2 }, ROW, { own: 1 }]"],
  ["texts", '[ROW, "text", new Row(0.5)]'],
  ["alone", "[ROW, ROW]"],
  ["lists", "[ROW, [1, 2], new Third(1)]"],
  ["many", "[new Row(1), new Other(2), new Third(3), new Heir(4), { size: 2 }, ROW, 0.5, true]"],
];
const handings: [name: string, text: string][] = [
  ["by-index", "for (let turn = 0; turn < rows.length; turn++) describe(rows[turn], turn);"],
  ["of", "let turn = 0;\nfor (const each of rows) describe(each, turn++);"],
  ["for-each", "rows.forEach((each, turn) => describe(each, turn));"],
  [
    "one-by-one",
    "describe(rows[0], 0);\ndescribe(rows[1], 1);\ndescribe(rows[rows.length - 1], 2);\ndescribe(rows[rows.length - 2], 3);",
  ],
  [
    "twice",
    "for (let round = 0; round < 2; round++) for (let turn = 0; turn < rows.length; turn++) describe(rows[turn], turn);",
  ],
];
const total = objects.length * tests.length * reads.length * shapes.length * companies.length * handings.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const object = pick(objects);
  const test = pick(tests);
  const read = pick(reads);
  const shape = pick(shapes);
  const company = pick(companies);
  const handing = pick(handings);
  const isTyped = cell % 3 === 0;
  const hasLid = cell % 2 === 1;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const type = (text: string) => (isTyped ? text : "");
  const body = shape[1].replaceAll("READ", () => `(${read[1]})`).replaceAll("TEST", () => test[1]).replace('let text = "/"', `let text${type(": any")} = "/"`).replace("let sum = 0", `let sum${type(": any")} = 0`).replaceAll("({ size })", `({ size }${type(": any")})`); // prettier-ignore
  // What the program does not use is left out: a class that nobody makes changes what is known of the others.
  const used = [object[1], test[1], body, company[1]].join(" ");
  const lines = [
    `class Row {\n${type("  size: any;\n  lid: any;\n")}  constructor(value${type(": any")}) {\n    this.size = value;\n    this.lid = value;\n  }\n}`,
    ...(/Heir/.test(used) ? [`class Heir extends Row {\n${type("  more: any;\n")}  constructor(value${type(": any")}) {\n    super(value);\n    this.more = 1;\n  }\n}`] : []),
    ...(/Other/.test(used) ? [`class Other {\n${type("  own: any;\n")}  constructor(value${type(": any")}) {\n    this.own = value;\n  }\n}`] : []),
    ...(/Third/.test(used) ? [`class Third {\n${type("  third: any;\n")}${type(hasLid ? "  lid: any;\n" : "")}  constructor(value${type(": any")}) {\n    this.third = value;\n${hasLid ? "    this.lid = value;\n" : ""}  }\n}`] : []),
    `const show = (value${type(": any")})${type(": string")} => (Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "object" : String(value));`,
    ...(/\bname\b/.test(used) ? ['const name = "size";'] : []),
    `const out${type(": any[]")} = [];`,
    ...(/\bread\b/.test(used) ? [`const read = (value${type(": any")})${type(": any")} => value.size;`] : []),
    ...(/\btouch\b/.test(used) ? [`const touch = (value${type(": any")}) => {\n  if (Object(value) === value) value.touched = 1;\n};`] : []),
    `function describe(value${type(": any")}, turn${type(": number")})${type(": any")} {`,
    indent(body, "  "),
    "}",
    object[1].replace("const row =", `const row${type(": any")} =`),
    `const rows${type(": any[]")} = ${company[1].replaceAll("ROW", "row")};`,
    "try {",
    indent(handing[1], "  "),
    "} catch (error) {",
    `  out.push((error${type(" as any")}).name);`,
    "}",
    'console.log(out.map(show).join(" "));',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return {
    name: `${object[0]}--${test[0]}--${read[0]}--${shape[0]}--${company[0]}${isTyped ? ".ts" : ".mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
