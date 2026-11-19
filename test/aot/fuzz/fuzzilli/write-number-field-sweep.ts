// A field that holds numbers wherever it is written, until something else is laid in by another way: what the objects are, times the way of the other value, times the value, times how the field is read, times where the objects stand, times when it happens.
//
//   bun write-number-field-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<objects>--<way>--<value>--<read>--<place>--<moment>.ts or .mjs
//   bun write-number-field-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `make(i)` makes one; the field is `x`, another number is `y`.
const objects: [name: string, text: string][] = [
  [
    "class",
    "class Item {\nFIELDS\n  constructor(i) {\n    this.x = i + 0.5;\n    this.y = i;\n  }\n}\nconst make = i => new Item(i);",
  ],
  [
    "class-of-initializers",
    "class Item {\n  x = 1.5;\n  y = 2;\n}\nconst make = i => {\n  const made = new Item();\n  made.x = i + 0.5;\n  return made;\n};",
  ],
  [
    "class-of-integers",
    "class Item {\nFIELDS\n  constructor(i) {\n    this.x = i | 0;\n    this.y = 3;\n  }\n  add(by) {\n    this.x += by;\n    return this.x;\n  }\n}\nconst make = i => new Item(i);",
  ],
  [
    "heir",
    "class Base {\n  x = 0.5;\n}\nclass Item extends Base {\n  y = 1;\n}\nconst make = i => {\n  const made = new Item();\n  made.x = i * 0.25;\n  return made;\n};",
  ],
  ["literal", "const make = i => ({ x: i + 0.5, y: i });"],
  ["literal-of-integers", "const make = i => ({ y: 1, x: i });"],
  ["literal-with-more", 'const make = i => ({ name: "n" + i, x: i * 1.5, y: i, list: [i] });'],
  ["spread", "const base = { x: 0.25, y: 1 };\nconst make = i => ({ ...base, x: i });"],
  ["assigned", "const make = i => {\n  const made = {};\n  made.x = i + 0.5;\n  made.y = i;\n  return made;\n};"],
  ["function", "function Item(i) {\n  this.x = i / 4;\n  this.y = i;\n}\nconst make = i => new Item(i);"],
  ["parsed", "const make = i => JSON.parse('{\"x\":' + i + ',\"y\":2}');"],
];
// `o` is the object, `V` the value; `N` is the name "x" out of a text that the build does not read.
const ways: [name: string, text: string][] = [
  ["written", "o.x = V;"],
  ["alias", "const alias = o;\nalias.x = V;"],
  ["by-name", "o[N] = V;"],
  ["by-written-name", 'o["x"] = V;'],
  ["assign", "Object.assign(o, { x: V });"],
  ["assign-by-name", "Object.assign(o, { [N]: V });"],
  ["pattern", "[o.x] = [V];"],
  ["object-pattern", "({ v: o.x } = { v: V });"],
  ["pattern-default", "[o.x = V] = [];"],
  ["pattern-rest", "[...o.x] = [V];"],
  ["for-of", "for (o.x of [1, V]);"],
  ["for-in", "for (o.x in { k: 1 });"],
  ["define", 'Object.defineProperty(o, "x", { value: V, writable: true, configurable: true, enumerable: true });'],
  ["define-getter", 'Object.defineProperty(o, "x", { get: () => V, configurable: true });'],
  ["reflect", "Reflect.set(o, N, V);"],
  ["delete", "delete o.x;"],
  ["delete-and-back", "delete o.x;\no.x = V;"],
  ["nullish", "o.x &&= V;"],
  ["parameter", "lay(o, V);"],
  ["method", "Laying.call(o, V);"],
  ["callback", "[V].forEach(function (value) {\n  this.x = value;\n}, o);"],
  ["prototype", "Object.setPrototypeOf(o, { x: V });\ndelete o.x;"],
  ["plus", "o.x += V;"],
  ["step", "o.x = V;\ntry {\n  o.x++;\n} catch {}"],
  ["entries", "for (const [name, value] of Object.entries({ x: V })) o[name] = value;"],
  ["proxy", "new Proxy(o, {}).x = V;"],
  ["nothing", ""],
];
const values = ['"s"', "undefined", "null", "true", "{ v: 1 }", "1.5", "2 ** 31", "-0", "NaN", "5n", "[7]", "() => 1", '"12"'] as const; // prettier-ignore
const reads: [name: string, text: string][] = [
  ["sum", "sum += o.x;"],
  ["product", "sum += o.x * o.y;"],
  ["typeof", "said += typeof o.x;"],
  ["text", 'said += o.x + ",";'],
  ["compared", "if (o.x > 2) sum += 1;\nelse sum += 10;"],
  ["equal", "if (o.x === 1.5) sum += 100;"],
  ["truth", "sum += o.x ? 1 : 1000;"],
  ["bits", "sum ^= o.x | 0;"],
  ["index", "sum += table[o.x] ?? 9;"],
  ["view", "view[0] = o.x;\nsum += view[0];"],
  ["pushed", "kept.push(o.x);"],
  ["copied", "const copy = { x: o.x };\nkept.push(copy.x);"],
  ["spread", "kept.push({ ...o }.x);"],
  ["pattern", "const { x, y } = o;\nkept.push(x);\nsum += y;"],
  ["stored", "other.x = o.x;\nkept.push(other.x);"],
  ["called", "kept.push(pass(o.x));"],
  ["captured", "const x = o.x;\nkept.push((() => x)());"],
  ["greatest", "sum = Math.max(sum, o.x);"],
  ["nothing", "sum += o.x == null ? 5 : 1;"],
  ["json", "said += JSON.stringify(o);"],
  ["swap", "[o.x, o.y] = [o.y, o.x];\nkept.push(o.x);"],
  ["method", "kept.push(o.add ? o.add(1) : o.x);"],
  ["twice", "sum += o.x - o.x;"],
];
// `EVENT` is the way; `READ` the read.
const places: [name: string, text: string][] = [
  [
    "list",
    "const items = [make(0), make(1), make(2), make(3)];\nfor (let i = 0; i < items.length; i++) {\n  const o = items[i];\nEVENT\nREAD\n}",
  ],
  ["one", "const o = make(1);\nfor (let i = 0; i < 5; i++) {\nEVENT\nREAD\n}"],
  ["new-ones", "for (let i = 0; i < 5; i++) {\n  const o = make(i);\nEVENT\nREAD\n}"],
  ["field", "const holder = { o: make(2) };\nfor (let i = 0; i < 5; i++) {\n  const o = holder.o;\nEVENT\nREAD\n}"],
  ["of-the-file", "for (let i = 0; i < 5; i++) {\n  const o = shared;\nEVENT\nREAD\n}"],
  [
    "map",
    "const items = new Map([[0, make(1)], [1, make(2)]]);\nfor (let i = 0; i < 6; i++) {\n  const o = items.get(i & 1);\nEVENT\nREAD\n}",
  ],
  [
    "nest",
    "const items = [make(0), make(1)];\nfor (let r = 0; r < 2; r++) {\n  for (let i = 0; i < items.length; i++) {\n    const o = items[i];\nEVENT\nREAD\n  }\n}",
  ],
  [
    "call",
    "const turn = (o, i) => {\nEVENT\nREAD\n};\nconst items = [make(0), make(1), make(2)];\nfor (let i = 0; i < 6; i++) turn(items[i % 3], i);",
  ],
];
const moments: [name: string, condition: string][] = [
  ["third", "i === 2"],
  ["second", "i === 1"],
  ["always", "i >= 0"],
  ["never", "fuel < 0"],
  ["later-round", "round === 1 && i === 0"],
];
const total = objects.length * ways.length * values.length * reads.length * places.length * moments.length;

function write(cell: number): { name: string; text: string } {
  let rest = Number((BigInt(cell) * 829348951n) % BigInt(total));
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const place = pick(places);
  const way = pick(ways);
  const read = pick(reads);
  const object = pick(objects);
  const value = pick(values);
  const moment = pick(moments);
  const isTyped = cell % 3 === 0;
  const t = (type: string) => (isTyped ? type : "");
  const laid = way[1].replaceAll(/\bV\b/g, () => (isTyped ? `(${value} as any)` : value)).replaceAll(/\bN\b/g, "named");
  const event = way[1] ? `if (${moment[1]}) {\n${laid}\n}` : "";
  const typed = (text: string) =>
    !isTyped
      ? text
      : text
          .replaceAll("make = i =>", "make = (i: number): any =>")
          .replaceAll("constructor(i)", "constructor(i: number)")
          .replaceAll("add(by)", "add(by: number)")
          .replaceAll("function Item(i)", "function Item(this: any, i: number)")
          .replaceAll("new Item(i);", object[0] === "function" ? "new (Item as any)(i);" : "new Item(i);")
          .replaceAll("const made = {};", "const made: any = {};")
          .replaceAll("turn = (o, i) =>", "turn = (o: any, i: number) =>")
          .replaceAll("function (value) {", "function (this: any, value: any) {");
  const fields = isTyped ? "  x: number;\n  y: number;" : "  z = 0;";
  const lines = [
    `const named = JSON.parse('"x"');`,
    `const table = [4, 5, 6];`,
    `const view = new Float64Array(1);`,
    `const pass = (value${t(": any")}) => value;`,
    `const lay = (o${t(": any")}, value${t(": any")}) => {\n  o.x = value;\n};`,
    `function Laying(${isTyped ? "this: any, value: any" : "value"}) {\n  this.x = value;\n}`,
    `const show = (value${t(": any")})${t(": string")} => (typeof value === "bigint" ? value + "n" : typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : Object.is(value, -0) ? "-0" : String(value));`,
    ...typed(object[1].replace("FIELDS", fields)).split("\n"),
    `const shared${t(": any")} = make(3);`,
    `const other${t(": any")} = make(9);`,
    `let fuel = JSON.parse("5");`,
    `function walk(round${t(": number")}) {`,
    `  let sum${t(": any")} = 0;`,
    `  let said = "";`,
    `  const kept${t(": any[]")} = [];`,
    `  try {`,
    ...typed(place[1].replace("EVENT", () => event).replace("READ", () => read[1])).split("\n").map(line => "    " + line),
    `  } catch (error${t(": any")}) {`,
    `    said += "!" + error.name;`,
    `  }`,
    `  return [show(sum), said, show(kept), show(shared), show(other)].join("|");`,
    `}`,
    `for (let round = 0; round < 3; round++) console.log(walk(round));`,
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return { name: `${object[0]}--${way[0]}--${read[0]}--${place[0]}--${moment[0]}${isTyped ? ".ts" : ".mjs"}`, text: lines.join("\n") + "\n" }; // prettier-ignore
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
