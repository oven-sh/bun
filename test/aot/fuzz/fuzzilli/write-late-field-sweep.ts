// Fields that come late: how the object is made, times who adds the field, times where, times what it holds, times how it is read, times the loop that reads.
//
//   bun write-late-field-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<object>--<adding>--<place>--<value>--<read>--<loop>.mjs or .ts
//   bun write-late-field-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is a number.
const objects: [name: string, text: string][] = [
  ["empty", "{}"],
  ["literal", "{ a: n, b: 2 }"],
  ["instance", "new Row(n)"],
  ["heir", "new Heir(n)"],
  ["made", "make(n)"],
  ["spread", "{ ...{ a: n } }"],
  ["bare", "Object.create(null)"],
  ["of-prototype", "Object.create({ late: 100, a: n })"],
  ["parsed", 'JSON.parse(`{"a":${n}}`)'],
  ["list", "[n, 2]"],
  ["function", "Object.assign(Math.max.bind(null, n), { a: n })"],
  ["by-turns", "n & 1 ? new Row(n) : { b: 1, a: n }"],
  ["with-setter", "withSetter(n)"],
  ["frozen", "Object.freeze({ a: n })"],
];
// `o` is the object, `V` the value.
const addings: [name: string, text: string][] = [
  ["field", "o.late = V;"],
  ["two", "o.late = V;\no.later = 1;"],
  ["if-missing", "if (o.late === undefined) o.late = V;"],
  ["or", "o.late ||= V;"],
  ["nullish", "o.late ??= V;"],
  ["added-to", "o.late = (o.late ?? 0) + V;"],
  ["counter", "o.late = (o.late | 0) + 1;"],
  ["key", 'o["la" + "te"] = V;'],
  ["assign", "Object.assign(o, { late: V });"],
  ["define", 'Object.defineProperty(o, "late", { value: V, writable: true, enumerable: true, configurable: true });'],
  ["deleted-first", "delete o.late;\no.late = V;"],
  ["method", "o.late = V;\no.ask = function () {\n  return this.late;\n};"],
  ["helper", "put(o, V);"],
  ["old-and-new", "o.a = V;\no.late = V;"],
];
// `ADD` is the adding, `list` the objects, `turn` counts.
const places: [name: string, text: string][] = [
  ["at-once", "for (const o of list) {\n  ADD\n}\nREAD"],
  ["in-the-loop", "INLOOP"],
  [
    "some",
    "for (let turn = 0; turn < list.length; turn++) {\n  const o = list[turn];\n  if (turn !== 1) {\n    ADD\n  }\n}\nREAD",
  ],
  ["last-alone", "{\n  const o = list[list.length - 1];\n  const turn = 5;\n  ADD\n}\nREAD"],
  ["behind-a-reading", "READ\nfor (const o of list) {\n  ADD\n}\nREAD"],
  ["callback", "list.forEach((o, turn) => {\n  ADD\n});\nREAD"],
  ["function", "const fill = (o, turn) => {\n  ADD\n};\nfor (let i = 0; i < list.length; i++) fill(list[i], i);\nREAD"],
  ["twice", "for (let turn = 0; turn < 2; turn++)\n  for (const o of list) {\n    ADD\n  }\nREAD"],
  [
    "tried",
    "for (const o of list) {\n  try {\n    ADD\n  } catch (error) {\n    notes.push(error.name);\n  }\n}\nREAD",
  ],
];
const values: [name: string, text: string][] = [
  ["integer", "3"],
  ["counter", "turn"],
  ["double", "0.5"],
  ["integer-or-double", "turn & 1 ? 0.25 : 2"],
  ["text", '"t" + turn'],
  ["number-or-text", 'turn & 1 ? "x" : turn'],
  ["object", "{ v: turn }"],
  ["list", "[turn]"],
  ["nothing", "undefined"],
  ["truth", "turn > 0"],
  ["large", "2 ** 31 + turn"],
  ["itself", "o"],
];
const reads: [name: string, text: string][] = [
  ["field", "show(o.late)"],
  ["plus", "o.late + 1"],
  ["sum", "(sum += o.late)"],
  ["integer", "o.late | 0"],
  ["both", "show([o.a, o.late])"],
  ["maybe", "show(o.late?.v)"],
  ["in", '"late" in o'],
  ["own", 'Object.hasOwn(o, "late")'],
  ["keys", "Object.keys(o).join()"],
  ["method", "show(o.ask?.())"],
  ["compared", "o.late > 1"],
  ["element", "show(o.late?.[0])"],
  ["written", "(o.late = (o.late ?? 0) + 1, show(o.late))"],
];
// `ADD` may stand in it.
const loops: [name: string, text: string][] = [
  ["of", "let turn = 0;\nfor (const o of list) {\n  turn++;\n  ADD\n  notes.push(ASK);\n}"],
  [
    "counted",
    "for (let turn = 0; turn < list.length; turn++) {\n  const o = list[turn];\n  ADD\n  notes.push(ASK);\n}",
  ],
  [
    "nested",
    "for (let round = 0; round < 2; round++)\n  for (let turn = 0; turn < list.length; turn++) {\n    const o = list[turn];\n    ADD\n    notes.push(ASK);\n  }",
  ],
  ["one-object", "const o = list[0];\nfor (let turn = 0; turn < 4; turn++) {\n  ADD\n  notes.push(ASK);\n}"],
  ["callback", "list.forEach((o, turn) => {\n  ADD\n  notes.push(ASK);\n});"],
  ["while", "let turn = list.length;\nwhile (turn-- > 0) {\n  const o = list[turn];\n  ADD\n  notes.push(ASK);\n}"],
  [
    "function",
    "const ask = (o, turn) => {\n  ADD\n  return ASK;\n};\nfor (let turn = 0; turn < list.length; turn++) notes.push(ask(list[turn], turn));",
  ],
];
const total = objects.length * addings.length * places.length * values.length * reads.length * loops.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const object = pick(objects);
  const adding = pick(addings);
  const place = pick(places);
  const value = pick(values);
  const read = pick(reads);
  const loop = pick(loops);
  const isTyped = cell % 4 === 1;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const type = (text: string) => (isTyped ? text : "");
  const add = adding[1].replaceAll(/\bV\b/g, () => (/^[\w.]+$/.test(value[1]) ? value[1] : `(${value[1]})`));
  const isInLoop = place[0] === "in-the-loop";
  const reading = "{\n" + indent(loop[1].replace("ADD", () => (isInLoop ? add : "")).replaceAll("ASK", () => read[1]), "  ") + "\n}"; // prettier-ignore
  let body = (isInLoop ? "READ" : place[1].replace("ADD", () => add)).replaceAll("READ", () => reading);
  if (/\bturn\b/.test(add) && !isInLoop && !/turn[ ,+]/.test(place[1].replace("ADD", ""))) body = "let turn = 0;\n" + body.replace(/for \(const o of list\) \{/, "for (const o of list) {\n  turn++;"); // prettier-ignore
  const typed = (text: string) =>
    isTyped
      ? text
          .replaceAll("(o, turn) =>", "(o: any, turn: number) =>")
          .replaceAll("catch (error)", "catch (error: any)")
          .replaceAll("function () {", "function (this: any) {")
      : text;
  const used = object[1];
  const lines = [
    `const notes${type(": any[]")} = [];`,
    `const show = (value${type(": any")})${type(": string")} => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).join() + "}" : Object.is(value, -0) ? "-0" : String(value));`,
    ...(/Row|Heir/.test(used) ? [`class Row {\n${type("  a: any;\n")}  b = 1;\n  constructor(a${type(": any")}) {\n    this.a = a;\n  }\n}`] : []),
    ...(/Heir/.test(used) ? [`class Heir extends Row {\n  c = 2;\n}`] : []),
    ...(/make\(/.test(used) ? [`const make = (n${type(": number")})${type(": any")} => {\n  const made${type(": any")} = {};\n  made.a = n;\n  if (n > 1) made.more = 1;\n  return made;\n};`] : []),
    ...(/withSetter\(/.test(used) ? [`const withSetter = (n${type(": number")})${type(": any")} => ({\n  a: n,\n  kept: ${isTyped ? "0 as any" : "0"},\n  set late(value${type(": any")}) {\n    this.kept = value;\n  },\n  get late() {\n    return this.kept;\n  },\n});`] : []),
    ...(/put\(/.test(add) ? [`const put = (o${type(": any")}, value${type(": any")}) => {\n  o.late = value;\n};`] : []),
    `function work(list${type(": any[]")}) {`,
    `  let sum${type(": any")} = 0;`,
    indent(typed(body), "  ").split("\n").filter(line => line.trim()).join("\n"),
    "  notes.push(String(typeof sum));",
    "}",
    "for (const n of [1, 2]) {",
    "  try {",
    `    work([${[1, 2, 3].map(k => object[1].replaceAll(/\bn\b/g, `(n + ${k})`)).join(", ")}]);`,
    "  } catch (error) {",
    `    notes.push((error${type(" as any")}).name);`,
    "  }",
    "}",
    'console.log(notes.map(show).join(" "));',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return {
    name: `${object[0]}--${adding[0]}--${place[0]}--${value[0]}--${read[0]}--${loop[0]}.${isTyped ? "ts" : "mjs"}`,
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
