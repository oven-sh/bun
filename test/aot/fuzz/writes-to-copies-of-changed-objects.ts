// An object is changed, closed or left open, and copied, and then the copy is written to. A copy is a new ordinary object: it has the enumerable own properties of its source and nothing else of it.
// Every kind of source x every change x every way to type it is one program. A program copies an open, a non-extensible, a sealed and a frozen source in every way, writes to a fresh copy in every way,
// and prints what the copy is after the write.

type Source = { name: string; declares?: string; declaresUntyped?: string; makes: string; makesUntyped?: string };

const literal: Source = { name: "a literal", makes: `{ a: 1, b: "x" }` };

const sources: readonly Source[] = [
  literal,
  { name: "an instance", declares: `class C { a = 1; b = "x"; }`, makes: "new C()" },
  {
    name: "an instance with a private field, a getter and a method",
    declares: `class C { a = 1; b = "x"; #h = 3; static has(x: any): boolean { return #h in x; } get g() { return 1; } m() { return 2; } }`,
    declaresUntyped: `class C { a = 1; b = "x"; #h = 3; static has(x) { return #h in x; } get g() { return 1; } m() { return 2; } }`,
    makes: "new C()",
  },
  {
    name: "an instance of a derived class",
    declares: `class B { a = 1; }\nclass C extends B { b = "x"; }`,
    makes: "new C()",
  },
  {
    name: "an instance with parameter properties",
    declares: "class C { constructor(public a: number, public b: string) {} }",
    declaresUntyped: "class C { constructor(a, b) { this.a = a; this.b = b; } }",
    makes: `new C(1, "x")`,
  },
  { name: "a literal without a prototype", makes: `{ __proto__: null, a: 1, b: "x" }` },
  { name: "a literal with a prototype", makes: `{ __proto__: P, a: 1, b: "x" }` },
  { name: "what Object.create made", makes: `Object.assign(Object.create(P), { a: 1, b: "x" })` },
  { name: "what Object.create made of null", makes: `Object.assign(Object.create(null), { a: 1, b: "x" })` },
  { name: "what JSON.parse made", makes: `JSON.parse('{"a":1,"b":"x"}')` },
  {
    name: "what JSON.parse made for a type",
    declares: "interface T { a: number; b: string }",
    declaresUntyped: "",
    makes: `JSON.parse('{"a":1,"b":"x"}') as T`,
    makesUntyped: `JSON.parse('{"a":1,"b":"x"}')`,
  },
  { name: "a function", makes: `Object.assign(function f() {}, { a: 1, b: "x" })` },
  { name: "an arrow function", makes: `Object.assign(() => 1, { a: 1, b: "x" })` },
  { name: "an array", makes: `Object.assign([10, 20], { a: 1, b: "x" })` },
  { name: "a copy", makes: `{ ...{ a: 1, b: "x" } }` },
  { name: "a copy of a frozen object", makes: `{ ...Object.freeze({ a: 1, b: "x" }) }` },
  {
    name: "an object filled by key",
    declares: `function fill(): Record<string, unknown> & { a: number; b: string } { const t: any = {}; for (const [key, value] of [["a", 1], ["b", "x"]] as [string, unknown][]) t[key] = value; return t; }`,
    declaresUntyped: `function fill() { const t = {}; for (const [key, value] of [["a", 1], ["b", "x"]]) t[key] = value; return t; }`,
    makes: "fill()",
  },
  {
    name: "an empty literal filled by name",
    declares: `function fill(): { a?: number; b?: string } { const t: { a?: number; b?: string } = {}; t.a = 1; t.b = "x"; return t; }`,
    declaresUntyped: `function fill() { const t = {}; t.a = 1; t.b = "x"; return t; }`,
    makes: "fill()",
  },
  {
    name: "what a constructor function made",
    declares: `const F: any = function (this: any) { this.a = 1; this.b = "x"; };`,
    declaresUntyped: `function F() { this.a = 1; this.b = "x"; }`,
    makes: "new F()",
  },
  {
    name: "an arguments object",
    declares: "function list(..._: unknown[]): any { return arguments; }",
    declaresUntyped: "function list() { return arguments; }",
    makes: `Object.assign(list(1, "x"), { a: 1, b: "x" })`,
  },
  { name: "a String object", makes: `Object.assign(new String("hi"), { a: 1, b: "x" })` },
  { name: "a literal with a getter", makes: `{ a: 1, get b() { return "x"; } }` },
  {
    name: "a literal with a setter",
    makes: `{ a: 1, b: "x", set c(v: unknown) {} }`,
    makesUntyped: `{ a: 1, b: "x", set c(v) {} }`,
  },
  { name: "a literal with a symbol", makes: `{ a: 1, b: "x", [s]: 4 }` },
  { name: "a literal with an index", makes: `{ a: 1, b: "x", 7: 7 }` },
  { name: "a literal with a computed name", makes: `{ a: 1, b: "x", [k]: 2 }` },
  { name: "a Date", makes: `Object.assign(new Date(0), { a: 1, b: "x" })` },
  { name: "a Map", makes: `Object.assign(new Map(), { a: 1, b: "x" })` },
  { name: "a proxy", makes: `new Proxy({ a: 1, b: "x" }, {})` },
  {
    name: "a literal with many members",
    makes: `{ a: 1, b: "x", ${Array.from({ length: 40 }, (_, i) => `f${i}: ${i}`).join(", ")} }`,
  },
  { name: "a literal of numbers", makes: `{ a: 1.5, b: "x", c: 2 ** 40, d: -0, e: NaN }` },
  {
    name: "a literal with or without an optional member",
    declares: `interface T { a: number; b: string; c?: number; d?: string }\nfunction pick(i: number): T { return i & 1 ? { a: 1, b: "x", c: 3 } : { a: 1, b: "x" }; }\nlet picks = 0;`,
    declaresUntyped: `function pick(i) { return i & 1 ? { a: 1, b: "x", c: 3 } : { a: 1, b: "x" }; }\nlet picks = 0;`,
    makes: "pick(picks++)",
  },
];

/** `O` is the source where a key may be stored under any name, `U` the source as a value of any type. */
const changes: readonly [name: string, text: string][] = [
  ["nothing", ""],
  ["a name", "O[k] = 2;"],
  ["an index", "O[n] = 3;"],
  ["a constant index", "O[5] = 3;"],
  ["a symbol", "O[s] = 4;"],
  ["a name and an index", "O[k] = 2; O[n] = 3;"],
  ["a name and a symbol", "O[k] = 2; O[s] = 4;"],
  ["a name, an index and a symbol", "O[k] = 2; O[n] = 3; O[s] = 4;"],
  ["a name that is deleted again", "O[k] = 2; delete O[k];"],
  ["a member is deleted", "delete U.a;"],
  ["a member is deleted, then a name", "delete U.a; O[k] = 2;"],
  ["a getter", "Object.defineProperty(o, k, { get() { return 9; }, enumerable: true, configurable: true });"],
  [
    "a getter in place of a member",
    `Object.defineProperty(o, "a", { get() { return 9; }, enumerable: true, configurable: true });`,
  ],
  [
    "a hidden name",
    "Object.defineProperty(o, k, { value: 2, enumerable: false, writable: true, configurable: true });",
  ],
  ["a member is hidden", `Object.defineProperty(o, "a", { enumerable: false });`],
  ["a member is hidden, then a name", `Object.defineProperty(o, "a", { enumerable: false }); O[k] = 2;`],
  ["a member is read-only", `Object.defineProperty(o, "a", { writable: false });`],
  ["a member is read-only, then a name", `Object.defineProperty(o, "a", { writable: false }); O[k] = 2;`],
  ["a read-only name", "O[k] = 2; Object.defineProperty(o, k, { writable: false });"],
  ["a name that is not configurable", "O[k] = 2; Object.defineProperty(o, k, { configurable: false });"],
  ["a member is not configurable", `Object.defineProperty(o, "a", { configurable: false });`],
  ["a private field", "new Stamp(o);"],
  ["a name and a private field", "O[k] = 2; new Stamp(o);"],
  ["a private method", "new Brand(o);"],
  ["a name and a private method", "O[k] = 2; new Brand(o);"],
  ["another prototype", "Object.setPrototypeOf(o, P);"],
  ["a name and another prototype", "O[k] = 2; Object.setPrototypeOf(o, P);"],
  ["a name and no prototype", "O[k] = 2; Object.setPrototypeOf(o, null);"],
  ["it is a prototype", "heirs.push(Object.create(o));"],
  ["a name, and it is a prototype", "O[k] = 2; heirs.push(Object.create(o));"],
  [
    "an own __proto__",
    `Object.defineProperty(o, "__proto__", { value: 1, enumerable: true, writable: true, configurable: true });`,
  ],
  ["eighty names", "for (let j = 0; j < 80; j++) O[k + j] = j;"],
  ["twenty indexes", "for (let j = 0; j < 20; j++) O[n + j * 3] = j;"],
  ["a far index and a name", "O[n + 100000] = 1; O[k] = 2;"],
];

const copies: readonly [name: string, text: string][] = [
  ["spread", "return { ...o };"],
  ["spread, then an index", "return { ...o, 1: 1 };"],
  ["spread, then a name", "return { ...o, m: 1 };"],
  ["spread, then a member", "return { ...o, a: 5 };"],
  ["spread, then a computed name", `return { ...o, [k + "c"]: 1 };`],
  ["a name, then spread", "return { first: 0, ...o };"],
  ["spread twice", "return { ...o, ...o };"],
  ["spread of a spread", "return { ...{ ...o } };"],
  ["Object.assign to an empty literal", "return Object.assign({}, o);"],
  ["Object.assign twice", "return Object.assign({}, o, o);"],
  ["Object.assign to the same members", `return Object.assign({ a: 0, b: "" }, o);`],
  ["Object.assign to an object without a prototype", "return Object.assign(Object.create(null), o);"],
  ["Object.assign to a non-extensible object", `return Object.assign(Object.preventExtensions({ a: 0, b: "" }), o);`],
  ["Object.assign to a frozen object", `return Object.assign(Object.freeze({ a: 0, b: "" }), o);`],
  ["structuredClone", "return structuredClone(o);"],
  ["rest", "const { ...r } = o; return r;"],
  ["rest without a member", "const { a, ...r } = U; return r;"],
  ["Object.fromEntries", "return Object.fromEntries(Object.entries(o));"],
  ["Object.defineProperties", "return Object.defineProperties({}, Object.getOwnPropertyDescriptors(o));"],
  [
    "Object.create with descriptors",
    "return Object.create(Object.getPrototypeOf(o), Object.getOwnPropertyDescriptors(o));",
  ],
];

const writes: readonly [name: string, text: string][] = [
  ["nothing", ""],
  ["a name", "c.w = 1;"],
  ["a computed name", `c[k + "2"] = 1;`],
  ["an index", `c[0] = "x";`],
  ["a computed index", `c[n + 1] = "y";`],
  ["a symbol", "c[s2] = 1;"],
  ["a member", "c.a = 7;"],
  ["the name", "c[k] = 8;"],
  ["the index", "c[n] = 8;"],
  ["Reflect.set of a name", `note(Reflect.set(c, "w", 1));`],
  ["Reflect.set of an index", `note(Reflect.set(c, 0, "x"));`],
  ["a defined name", `note(Reflect.defineProperty(c, "d", { value: 1 }));`],
  ["a defined index", "note(Reflect.defineProperty(c, 3, { value: 1 }));"],
  ["a defined getter", `note(Reflect.defineProperty(c, "g", { get() { return 1; }, enumerable: true }));`],
  ["a member defined again", `note(Reflect.defineProperty(c, "a", { value: 6, enumerable: false }));`],
  ["the name defined again", "note(Reflect.defineProperty(c, k, { value: 6, enumerable: false }));"],
  ["a member deleted", "note(delete c.a);"],
  ["the name deleted", "note(delete c[k]);"],
  ["the index deleted", "note(delete c[n]);"],
  ["another prototype", "note(Reflect.setPrototypeOf(c, Q));"],
  ["push", "Array.prototype.push.call(c, 1);"],
  ["Object.assign", "Object.assign(c, { w: 1, 2: 2 });"],
  ["Object.freeze", "Object.freeze(c);"],
  ["a private field", "new Stamp(c);"],
  ["a private method", "new Brand(c);"],
];

type Typing = {
  name: string;
  file: string;
  source?: string;
  declares?: string;
  comment?: string;
  isOfLiteralAlone?: true;
};

const typings: readonly Typing[] = [
  { name: "any", file: "main.ts", source: "any" },
  { name: "the type that is inferred", file: "main.ts" },
  { name: "JavaScript", file: "main.js" },
  {
    name: "an index signature",
    file: "main.ts",
    source: "R",
    declares: "interface R { a: number; b: string; [key: string]: unknown; [key: symbol]: unknown }",
    isOfLiteralAlone: true,
  },
  { name: "any in JSDoc", file: "main.js", comment: "/** @type {any} */", isOfLiteralAlone: true },
];

const table = typings.flatMap(typing =>
  (typing.isOfLiteralAlone ? [literal] : sources).flatMap(source =>
    changes.map(change => ({ typing, source, change })),
  ),
);

export const programs = table.length;

export const nameOf = (index: number) =>
  `${table[index].source.name} | ${table[index].change[0]} | ${table[index].typing.name}`;

export function programOf(index: number): { file: string; text: string } {
  const { typing, source, change } = table[index];
  const isTyped = typing.file.endsWith(".ts");
  const typed = (type: string) => (isTyped ? `: ${type}` : "");
  const any = typed("any");
  const ofSource = typing.source ? typed(typing.source) : "";
  const parameter = isTyped ? `: ${typing.source ?? "ReturnType<typeof make>"}` : "";
  const untypedSource = isTyped ? "(o as any)" : "o";
  const keyed = typing.source ? "o" : untypedSource;
  const inPlace = (text: string) => text.replace(/\bO\b/g, keyed).replace(/\bU\b/g, untypedSource);
  const list = (rows: readonly [string, string][], callee: string) =>
    rows.map(([name], at) => `[${JSON.stringify(name)}, ${callee}${at}]`).join(", ");
  const hasClassWithPrivateField = source.declares?.includes("static has(") ?? false;
  return {
    file: typing.file,
    text: `${[typing.declares, isTyped ? source.declares : (source.declaresUntyped ?? source.declares)].filter(Boolean).join("\n")}
const k${typed("string")} = process.argv[2] ?? "z";
const n${typed("number")} = Number(process.argv[3] ?? 5);
const s = Symbol("s"), s2 = Symbol("s2");
const P${any} = { inherited: 1 }, Q${any} = { other: 2 };
const heirs${typed("any[]")} = [];
const Base${any} = function (x${any}) { return x; };
class Stamp extends Base { #p = 1; static has(x${any})${typed("boolean")} { return #p in x; } }
class Brand extends Base { #m() {} static has(x${any})${typed("boolean")} { return #m in x; } }
let notes${typed("string[]")} = [];
function note(x${any}) { notes.push(String(x)); }
function make(level${typed("number")})${ofSource} {
  ${typing.comment ?? ""}
  const o${ofSource} = ${isTyped ? source.makes : (source.makesUntyped ?? source.makes)};
  ${inPlace(change[1])}
  if (level === 1) Object.preventExtensions(o);
  else if (level === 2) Object.seal(o);
  else if (level === 3) Object.freeze(o);
  return o;
}
function json(c${any})${typed("string")} { try { return JSON.stringify(c); } catch (e${any}) { return e.constructor.name; } }
function valueOf(v${any})${typed("string")} { return typeof v === "function" ? "function" : Object.is(v, -0) ? "-0" : String(JSON.stringify(v)); }
function describe(c${any})${typed("string")} {
  const d${any} = Object.getOwnPropertyDescriptors(c);
  const parts${typed("string[]")} = [];
  for (const key of Reflect.ownKeys(d)) {
    const p = d[key];
    parts.push(String(key) + ":" + ("value" in p ? valueOf(p.value) : (p.get ? "get" : "") + (p.set ? "set" : "")) + (p.writable ? "w" : "-") + (p.enumerable ? "e" : "-") + (p.configurable ? "c" : "-"));
  }
  const proto = Object.getPrototypeOf(c);
  const forIn${typed("string[]")} = [];
  for (const key in c) forIn.push(key);
  return [
    (Object.isExtensible(c) ? "E" : "-") + (Object.isSealed(c) ? "S" : "-") + (Object.isFrozen(c) ? "F" : "-"),
    proto === Object.prototype ? "Object.prototype" : proto === null ? "null" : proto === P ? "P" : proto === Q ? "Q" : "another",
    Array.isArray(c) ? "array" : typeof c,
    parts.join(" "),
    Object.keys(c).join(),
    forIn.join(),
    json(c),
    Stamp.has(c),
    Brand.has(c)${hasClassWithPrivateField ? ",\n    C.has(c)" : ""},
  ].join(" | ");
}
${copies.map(([, text], at) => `function copy${at}(o${parameter})${any} { ${inPlace(text)} }`).join("\n")}
${writes.map(([, text], at) => `function write${at}(c${any}) { ${text} }`).join("\n")}
const copies${typed("[string, (o: any) => any][]")} = [${list(copies, "copy")}];
const writes${typed("[string, (c: any) => void][]")} = [${list(writes, "write")}];
for (const level of [1, 0, 2, 0, 3]) {
  for (const [copied, copy] of copies) {
    for (const [written, write] of writes) {
      notes = [];
      let line = level + " " + copied + ", " + written + ": ";
      let c${any};
      try {
        c = copy(make(level));
      } catch (e${any}) {
        console.log(line + "the copy THROWS " + e.constructor.name);
        continue;
      }
      try {
        write(c);
      } catch (e${any}) {
        line += "THROWS " + e.constructor.name + " ";
      }
      console.log(line + notes.join() + " " + describe(c));
    }
  }
}
`,
  };
}
