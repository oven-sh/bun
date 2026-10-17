// Programs in which a value comes by one of two arms (`a || b`, `a && b`, `a ?? b`, `c ? a : b`) and goes on to a place with a type: a variable,
// a field, a property of a literal, a parameter, an element. Every value is made by typed code and satisfies its type, so nothing may be refused:
// what is known of one arm (`list.some(..)` is a boolean) says nothing of what comes by the other (`undefined`).
//
// A program is one kind of value and one way of joining. Each combination of a source, what comes by the other arm and a place is a function of
// its own, run on three sets of data: empty, truthy and falsy.
export const kinds = ["boolean", "number", "string"] as const;
export type Kind = (typeof kinds)[number];

const sources: Record<Kind, string[]> = {
  boolean: [
    "d.list.some(i => i.flag === true)", "d.list.every(i => i.flag === true)", "d.list.includes(d.first)", "d.rec.flag", 'd.flags.get("a")', 'd.text.startsWith("a")', "d.isSet()",
    "d.list[0]?.flag", 'd.names.has("a")', "Array.isArray(d.list)",
  ],
  number: [
    "d.list.length", 'd.sizes.get("a")', "d.rec.n", 'd.text.indexOf("a")', "d.count()", "d.numbers.find(n => n > 1)", "d.numbers.at(0)", "d.list[0]?.n", "Math.max(d.numbers.length, 0)",
    "d.numbers.indexOf(2)",
  ],
  string: ["d.text", "d.rec.s", 'd.words.get("a")', "d.text.at(0)", "d.name()", "d.strings.find(s => s.length > 1)", 'd.strings.join("")', "d.list[0]?.s", "d.text.slice(1)", "d.strings.pop()"],
};
const others: Record<Kind, string[]> = {
  boolean: ["undefined", "true", "false", "d.rec.flag", "d.isSet()"],
  number: ["undefined", "0", "7", "d.rec.n", "d.count()"],
  string: ["undefined", '""', '"other"', "d.rec.s", "d.name()"],
};
const field: Record<Kind, string> = { boolean: "flag", number: "n", string: "s" };

export const joins = ["A || B", "A && B", "A ?? B", "d.isSet() ? A : B", "(A || B) ?? B", "A || (d.isSet() && B)", "(A ?? B) || undefined"];
const yieldsFalseToo = "A || (d.isSet() && B)";

const places: { text: string; isOfTheKind: boolean }[] = [
  { text: "const v = E; return v;", isOfTheKind: false },
  { text: "let v: T | undefined = E; return v;", isOfTheKind: true },
  { text: "return E;", isOfTheKind: false },
  { text: "const h = new Holder(); h.F = E; return h.F;", isOfTheKind: true },
  { text: "const r: Rec = { F: E }; return r.F;", isOfTheKind: true },
  { text: "const r: Open = { F: E, ...d.more }; return r.F;", isOfTheKind: true },
  { text: "const r: Open = { ...d.more, F: E }; return r.F;", isOfTheKind: true },
  { text: "return take(E);", isOfTheKind: true },
  { text: "const l: (T | undefined)[] = [E]; return l[0];", isOfTheKind: true },
  { text: "const r = { inner: { F: E } }; return r.inner.F;", isOfTheKind: false },
  { text: "const h = new Holder(); const v = E; h.F = v; return h.F;", isOfTheKind: true },
  { text: "let v; v = E; return v;", isOfTheKind: false },
];

const head = `declare const console: { log(...values: unknown[]): void };
interface Item { flag?: boolean; n?: number; s?: string }
interface Rec { flag?: boolean | undefined; n?: number | undefined; s?: string | undefined }
type Open = { flag?: boolean | undefined; n?: number | undefined; s?: string | undefined; [more: string]: unknown };
class Holder { flag?: boolean; n?: number; s?: string; }
class Data {
  first: Item; more: Open = {};
  constructor(public list: Item[], public rec: Rec, public text: string, public numbers: number[], public strings: string[], public flags: Map<string, boolean>, public sizes: Map<string, number>, public words: Map<string, string>, public names: Set<string>, private set: boolean) { this.first = list[0] ?? {}; }
  isSet(): boolean { return this.set; } count(): number { return this.numbers.length; } name(): string { return this.text; }
}
const make: (() => Data)[] = [
  () => new Data([], {}, "", [], [], new Map(), new Map(), new Map(), new Set(), false),
  () => new Data([{ flag: true, n: 3, s: "x" }], { flag: true, n: 5, s: "rec" }, "abc", [1, 2, 3], ["p", "qq"], new Map([["a", true]]), new Map([["a", 9]]), new Map([["a", "word"]]), new Set(["a"]), true),
  () => new Data([{ flag: false, n: 0, s: "" }], { flag: false, n: 0, s: "" }, "b", [0], [""], new Map([["a", false]]), new Map([["a", 0]]), new Map([["a", ""]]), new Set(["b"]), false),
];
const all: [string, (d: Data) => unknown][] = [];
`;
const foot = `for (const [name, f] of all) { let said = name + ":"; for (const m of make) { try { said += " " + String(f(m())); } catch (e) { said += " THROWS " + String(e).split(" (bun")[0]; } } console.log(said); }
`;

export function program(kind: Kind, join: string) {
  const lines = [head, `function take(v: ${kind} | undefined): ${kind} | undefined { return v; }\n`];
  for (const source of sources[kind])
    for (const other of others[kind])
      for (const place of places) {
        if (join === yieldsFalseToo && kind !== "boolean" && place.isOfTheKind) continue;
        const joined = join.replaceAll("A", () => source).replaceAll("B", () => other);
        const body = place.text.replaceAll("E", () => joined).replaceAll("F", field[kind]).replaceAll("T", kind);
        lines.push(`all.push([${JSON.stringify(body)}, (d: Data) => { ${body} }]);\n`);
      }
  return { file: "main.ts", text: lines.join("") + foot, files: { "tsconfig.json": `{ "compilerOptions": { "strict": true, "target": "ESNext", "module": "Preserve", "noEmit": true } }` } };
}
