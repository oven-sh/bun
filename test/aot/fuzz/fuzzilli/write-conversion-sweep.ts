// Objects that become numbers and texts: how the object converts, times the operator, times what happens to the object on the way, times where the operator stands, times the other operand.
//
//   bun write-conversion-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<object>--<operator>--<change>--<place>--<other>.mjs
//   bun write-conversion-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is a number; every conversion is noted.
const objects: [name: string, text: string][] = [
  ["value-of", 'made({ valueOf() {\n  note("v");\n  return n;\n} })'],
  ["value-of-double", "made({ valueOf: () => n + 0.5 })"],
  ["value-of-text", 'made({ valueOf: () => "7" })'],
  ["value-of-nothing", "made({ valueOf: () => undefined })"],
  ["value-of-null", "made({ valueOf: () => null })"],
  ["value-of-truth", "made({ valueOf: () => true })"],
  ["value-of-big", "made({ valueOf: () => 3n })"],
  ["value-of-object", 'made({ valueOf: () => ({}), toString() {\n  note("s");\n  return "4";\n} })'],
  ["to-string", 'made({ toString() {\n  note("s");\n  return "t" + n;\n} })'],
  ["to-string-number", "made({ toString: () => n })"],
  ["both", 'made({ valueOf() {\n  note("v");\n  return n;\n}, toString() {\n  note("s");\n  return "x";\n} })'],
  ["neither", "made({ valueOf: () => ({}), toString: () => [] })"],
  ["bare", "Object.create(null)"],
  ["primitive", "made({ [Symbol.toPrimitive](hint) {\n  note(hint);\n  return n;\n} })"],
  [
    "primitive-by-hint",
    'made({ [Symbol.toPrimitive]: hint => (hint === "string" ? "p" : hint === "number" ? 2 : n) })',
  ],
  ["primitive-nothing", "made({ [Symbol.toPrimitive]: undefined, valueOf: () => 6 })"],
  ["primitive-object", "made({ [Symbol.toPrimitive]: () => ({}) })"],
  ["throws", 'made({ valueOf() {\n  throw new RangeError("v");\n} })'],
  ["class", "new Money(n)"],
  ["heir", "new Tax(n)"],
  ["class-primitive", "new Span(n)"],
  ["getter", 'made({ get valueOf() {\n  note("g");\n  return () => n;\n} })'],
  ["date", "new Date(n * 1000)"],
  ["list", "[n]"],
  ["two-list", "[n, 2]"],
  ["empty-list", "[]"],
  ["boxed", "new Number(n)"],
  ["boxed-text", 'new String("5")'],
  ["boxed-truth", "new Boolean(false)"],
  ["function", "(() => 1)"],
  ["plain", "{ v: n }"],
  ["map", "new Map()"],
  ["counts", "made({ valueOf: () => turns++ })"],
  ["own-literal", "{ v: n, valueOf() {\n  return this.v * 2;\n} }"],
];
// `o` is the object, `p` the other operand.
const operators: [name: string, text: string][] = [
  ["minus", "o - p"],
  ["minus-behind", "p - o"],
  ["plus", "o + p"],
  ["plus-behind", "p + o"],
  ["times", "o * p"],
  ["divided", "o / p"],
  ["remainder", "o % p"],
  ["power", "o ** p"],
  ["less", "o < p"],
  ["greater", "p > o"],
  ["at-most", "o <= p"],
  ["equal", "o == p"],
  ["unequal", "p != o"],
  ["same", "o === p"],
  ["unary-plus", "+o"],
  ["unary-minus", "-o"],
  ["integer", "o | 0"],
  ["and", "o & p"],
  ["shift", "o << p"],
  ["unsigned", "o >>> 0"],
  ["not", "~o"],
  ["number", "Number(o)"],
  ["text", "String(o)"],
  ["template", "`${o}:${p}`"],
  ["joined", "[o, p].join()"],
  ["maximum", "Math.max(o, p)"],
  ["floor", "Math.floor(o)"],
  ["imul", "Math.imul(o, 3)"],
  ["is-nan", "isNaN(o)"],
  ["parse", "parseInt(o)"],
  ["key", '({ 1: "one", 7: "seven", p: "p" })[o]'],
  ["element", "[10, 11, 12, 13][o]"],
  ["character", '"abcdef".charAt(o)'],
  ["concatenated", '"a".concat(o)'],
  ["repeat", '"z".repeat(o)'],
  ["increment", "(() => {\n  let x = o;\n  x++;\n  return x;\n})()"],
  ["add-assign", "(() => {\n  let x = p;\n  x += o;\n  return x;\n})()"],
  ["both-sides", "o - o"],
  ["twice", "o * p + o"],
  ["sorted", "[o, p, 3].sort((a, b) => a - b).length"],
  ["big", "typeof BigInt(o)"],
  ["truth", "o ? 1 : 2"],
  ["switch", "(() => {\n  switch (o) {\n    case p:\n      return 1;\n    default:\n      return 2;\n  }\n})()"],
];
// What happens to the object in the middle of the loop, at `turn` 2.
const changes: [name: string, text: string][] = [
  ["nothing", ""],
  ["replaced", "if (turn === 2) o.valueOf = () => 40;"],
  ["text-replaced", 'if (turn === 2) o.toString = () => "50";'],
  ["primitive-added", "if (turn === 2) o[Symbol.toPrimitive] = () => 60;"],
  ["deleted", "if (turn === 2) delete o.valueOf;"],
  ["field", "if (turn === 2) o.v = 9;"],
  ["parent", "if (turn === 2) Object.setPrototypeOf(o, { valueOf: () => 70 });"],
  ["other-object", "if (turn === 2) o = { valueOf: () => 80 };"],
  ["number", "if (turn === 2) o = 4;"],
  ["nothing-value", "if (turn === 2) o = undefined;"],
  ["class-changed", "if (turn === 2) Money.prototype.valueOf = () => 90;"],
];
const places: [name: string, text: string][] = [
  ["loop", "for (let turn = 0; turn < 4; turn++) {\n  CHANGE\n  note(ASK);\n}"],
  ["sum", "let sum = 0;\nfor (let turn = 0; turn < 4; turn++) {\n  CHANGE\n  sum += Number(ASK);\n}\nnote(sum);"],
  [
    "tried",
    "for (let turn = 0; turn < 4; turn++) {\n  CHANGE\n  try {\n    note(ASK);\n  } catch (error) {\n    note(error.name);\n  }\n}",
  ],
  ["callback", "[0, 1, 2, 3].forEach(turn => {\n  CHANGE\n  note(ASK);\n});"],
  ["function", "const ask = (o, p) => ASK;\nfor (let turn = 0; turn < 4; turn++) {\n  CHANGE\n  note(ask(o, p));\n}"],
  [
    "condition",
    "let count = 0;\nfor (let turn = 0; turn < 4; turn++) {\n  CHANGE\n  if (ASK) count++;\n}\nnote(count);",
  ],
  [
    "element",
    "const list = [o, o];\nfor (let turn = 0; turn < 3; turn++) {\n  CHANGE\n  o = list[turn & 1];\n  note(ASK);\n}",
  ],
  ["once", "const turn = 2;\nnote(ASK);\nCHANGE\nnote(ASK);"],
];
const others: [name: string, text: string][] = [
  ["integer", "2"],
  ["zero", "0"],
  ["double", "1.5"],
  ["text", '"3"'],
  ["nothing", "undefined"],
  ["object", "made({ valueOf: () => 3 })"],
  ["truth", "true"],
];
const total = objects.length * operators.length * changes.length * places.length * others.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const object = pick(objects);
  const operator = pick(operators);
  const change = pick(changes);
  const place = pick(places);
  const other = pick(others);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  // Two objects of a kind in every other program.
  const isTwo = cell % 2 === 0;
  const lines = [
    "const notes = [];",
    "let turns = 1;",
    'const note = value => void notes.push(typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : typeof value === "string" ? value.slice(0, 24) : String(value));',
    "const made = object => object;",
    "class Money {\n  constructor(v) {\n    this.v = v;\n  }\n  valueOf() {\n    return this.v;\n  }\n}",
    'class Tax extends Money {\n  toString() {\n    return "tax" + this.v;\n  }\n}',
    'class Span {\n  #v;\n  constructor(v) {\n    this.#v = v;\n  }\n  [Symbol.toPrimitive](hint) {\n    return hint === "string" ? this.#v + "s" : this.#v;\n  }\n}',
    "function work(n) {",
    `  let o = ${indent(object[1], "  ").trimStart()};`,
    `  const p = ${other[1]};`,
    indent(place[1].replaceAll("CHANGE", () => change[1]).replaceAll("ASK", () => operator[1]), "  ").split("\n").filter(line => line.trim()).join("\n"), // prettier-ignore
    "}",
    `for (const n of ${isTwo ? "[1, 3]" : "[2]"}) {`,
    "  try {",
    "    work(n);",
    "  } catch (error) {",
    "    note(error.name);",
    "  }",
    "}",
    'console.log(notes.join(" "));',
  ]; // prettier-ignore
  return {
    name: `${object[0]}--${operator[0]}--${change[0]}--${place[0]}--${other[0]}.mjs`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
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
