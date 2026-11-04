// `const o = { f: () => 1 }; Object.assign(o, JSON.parse('{"f":2}')); o.f`: a field that the program's own text only ever
// gives one kind of value (a function, an object, a string, an integer) gets a value of another kind from a builtin, under
// a key made at run time or from text made at run time. A compiler that keeps a narrow slot for the field has to put such a
// value elsewhere, and every way of reading the field has to find it there. Each scene varies how the object is made, how
// the value is stored, which kind it has and how the field is read afterwards.
import type { Random } from "./random";

/** Expressions that make the object. `F` is the field, `HELD` a class of the scene, `ABOVE` one with a default for the field on its prototype. */
const makers = [
  "{ F() { return 1; } }",
  "{ F() { return 1; } }",
  "{ F: () => 1 }",
  "{ F: () => 1 }",
  "{ F: function () { return 1; } }",
  "{ F: { n: 1 } }",
  "{ F: [1, 2] }",
  '{ F: "text" }',
  '{ F: word("text") }',
  "new HELD(true)",
  "new HELD(false)",
  "new HELD(turn % 2 === 0)",
  "{ ...{ F() { return 1; } } }",
  '{ other: 1, F: () => 1, last: "z" }',
  "{ F: 1 }",
  "{ F: 1.5 }",
  "{ F: true }",
  "{ F: null }",
  "{ F: undefined }",
  "{ get F() { return () => 1; }, set F(given) {} }",
  "Object.create({ F() { return 1; } })",
  "new ABOVE(true)",
  "new ABOVE(false)",
  "new ABOVE(turn % 2 === 0)",
  "new ABOVE(turn % 2 === 0)",
];

/** Statements that store `y` through `loose`, which is the object. */
const stores = [
  "Object.assign(loose, JSON.parse('{\"F\":2}'));",
  "Object.assign(loose, JSON.parse('{\"F\":2}'));",
  "Object.assign(loose, { F: y });",
  "Object.assign(loose, { F: y });",
  'Object.assign(loose, Object.fromEntries([["F", y]]));',
  "loose[KEY] = y;",
  "loose[KEY] = y;",
  "loose[KEY] = y;",
  'loose["F"] = y;',
  "loose.F = y;",
  'Object.defineProperty(loose, "F", { value: y });',
  'Object.defineProperty(loose, "F", { value: y, writable: true, enumerable: true, configurable: true });',
  'Reflect.defineProperty(loose, "F", { value: y, configurable: true });',
  'Reflect.set(loose, "F", y);',
  "Object.defineProperties(loose, { F: { value: y, enumerable: true } });",
  "({ F: loose.F } = { F: y });",
  "for (const [name, value] of Object.entries({ F: y })) loose[name] = value;",
  'store(loose, "F", y);',
  "delete loose.F;\n  loose[KEY] = y;",
  'Reflect.deleteProperty(loose, "F");',
  "Object.freeze(loose);",
];

/** Statements that read the field. `o` has the type of the maker, `loose` is the same object without a type. */
const reads = [
  "note(o.F);",
  "note(o.F);",
  "note(loose[KEY]);",
  "note({ ...o }.F);",
  "note({ ...o }.F);",
  "{\n    const { F: read } = o;\n    note(read);\n  }",
  'note("F" in o);',
  "note(Object.values(o).length);\n  note(Object.values(o)[0]);",
  "note(JSON.stringify(o));",
  "note(loose.F?.call?.(o));",
  "note(typeof o.F);",
  "note(Object.assign({}, o).F);",
  'note(Object.getOwnPropertyDescriptor(o, "F")?.value);',
  'note(Object.hasOwn(o, "F"));',
  "note(READ(o));",
  "note(READ(o));",
  "note(Object.entries(o).map(([name, value]) => name + typeof value).join());",
  "for (const name in o) note(name);",
  "note(o.F === loose[KEY]);",
];

const values = [
  "2",
  "1.5",
  "true",
  "false",
  "null",
  "undefined",
  "10n",
  '"a"',
  '""',
  "-0",
  "NaN",
  "Symbol.iterator",
  "function other() {}",
  "{ n: 2 }",
  "[3]",
  "2147483648",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const field = `n${scene}${random.pick(["a", "value", "run", "x1"])}`;
    const fill = (text: string) =>
      text
        .replaceAll("HELD", `Held${scene}`)
        .replaceAll("ABOVE", `Above${scene}`)
        .replaceAll("KEY", `key${scene}`)
        .replaceAll("READ", `read${scene}`)
        .replace(/\bF\b/g, field);
    const maker = fill(random.pick(makers));
    const isSplit = random.chance(0.4);
    const stored = random.sample(stores, random.pick([1, 1, 2])).map(fill);
    const read = random.sample(reads, random.between(1, 3)).map(fill);
    const early = random.chance(0.3) ? fill(random.pick(reads)) : "";
    const given = random.chance(0.4)
      ? `JSON.parse('[{"y":""},{"y":true},{"x":1},{"y":"a"},{"y":2},{"y":1.5},{"y":null}]').map((row${as("any")}) => row.y)`
      : `[${random.sample(values, random.between(2, 6)).join(", ")}]`;
    scenes.push(`class Held${scene} {
  ${typed ? `declare ${field}?: () => number;` : ""}
  constructor(given${as("boolean")}) {
    if (given) this.${field} = () => 1;
  }
}
class Above${scene} {
  ${typed ? `declare ${field}?: () => number;` : ""}
  constructor(given${as("boolean")}) {
    if (given) this.${field} = () => 1;
  }
}
${typed ? `(Above${scene}.prototype as any)` : `Above${scene}.prototype`}.${field} = ${random.pick(["5", "5", '"above"', "() => 2", "undefined", "1.5"])};
const key${scene} = word(${JSON.stringify(field)});
function read${scene}(held${as(`{ ${field}?: unknown }`)}) {
  return held.${field};
}
${isSplit ? `function make${scene}(turn${as("number")}) {\n  return ${maker};\n}\nfunction change${scene}(loose${as("any")}, y${as("unknown")}) {\n  ${stored.join("\n  ")}\n}` : ""}
function run${scene}(y${as("unknown")}, turn${as("number")}) {
  const o = ${isSplit ? `make${scene}(turn)` : maker};
  const loose${as("any")} = o;
  ${early}
  ${isSplit ? `change${scene}(o, y);` : stored.join("\n  ")}
  ${read.join("\n  ")}
}
{
  let turn = 0;
  for (let round = 0; round < ${random.pick([1, 1, 3, 30])}; round++) {
    for (const y of ${given}) {
      try {
        run${scene}(y, turn++);
      } catch (error) {
        note("threw " + ${typed ? "(error as Error)" : "error"}?.constructor?.name);
      }
    }
  }
  console.log("scene ${scene}", said());
}`);
  }
  return `const word${as("(text: string) => string")} = Function("text", "return text")${typed ? " as (text: string) => string" : ""};
const store${as("any")} = Function("held", "name", "value", "held[name] = value;");
const notes = new Map${typed ? "<string, number>" : ""}();
function note(value${as("unknown")}) {
  const text =
    typeof value === "function"
      ? "function " + value.name
      : typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  notes.set(text, (notes.get(text) ?? 0) + 1);
}
function said()${as("string")} {
  const text = [...notes].map(([each, times]) => each + " x" + times).join("; ");
  notes.clear();
  return text;
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
