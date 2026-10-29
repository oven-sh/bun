// A few objects of one kind of layout, a drawn list of changes to one or another of them, and after each change a look at them in every way. The kinds: classes with fields of every
// declared type, optional and declared-only fields, literals, unions with a tag, private names, symbols, heirs, constructor functions, Object.create, parsed text, many fields, closures in fields,
// accessors, objects in fields, fields added late, heirs of built-in classes, and class objects, prototypes and functions themselves.
//
// A program is a seed. The same seed always writes the same program.
import { look, Random } from "./every-way-to-look-at-an-object";

interface Birth {
  name: string;
  decl: string;
  make: (r: Random) => string;
  type: string;
  keys: string[];
  /** Statements that read through a reference `o` of the declared type and return an array. */
  reads: string;
  /** Typed stores: [key, values of the declared type]. */
  stores: [string, string[]][];
}

const wideTypes = ["number", "string", "boolean", "number | undefined", "string | null", "number"];
const wideValues = ["I", '"sI"', "true", "undefined", "null", "I.5"];

const births: Record<string, (n: string) => Birth> = {
  "class-plain": n => ({
    name: "class-plain",
    decl: `class A${n} { a = 1; b = "s"; c = true; d = 1.5; e: number | undefined = undefined; f: string | null = null; g = { inner: 1 }; h = [1, 2]; m() { return this.a; } }`,
    make: () => `new A${n}()`,
    type: `A${n}`,
    keys: ["a", "b", "c", "d", "e", "f", "g", "h"],
    reads: `[o.a, o.b, o.c, o.d, o.e, o.f, o.g, o.g?.inner, o.h, o.h?.length, o.m?.()]`,
    stores: [["a", ["7", "-0", "2.5", "NaN", "-2147483648"]], ["b", ['"t"', '""']], ["c", ["false"]], ["d", ["3", "-0", "NaN"]], ["e", ["4", "undefined", "-2147483647", "0.5"]], ["f", ['"u"', "null"]]],
  }),
  "class-declared-optional": n => ({
    name: "class-declared-optional",
    decl: `class A${n} { declare a?: number; declare b?: string; declare c?: boolean; declare d?: number; declare e?: { x: number }; z = 0; constructor(w: number) { if (w & 1) this.a = 1; if (w & 2) this.b = "s"; if (w & 4) this.c = false; if (w & 8) this.d = 0.5; if (w & 16) this.e = { x: 1 }; } }`,
    make: r => `new A${n}(${r.int(32)})`,
    type: `A${n}`,
    keys: ["a", "b", "c", "d", "e", "z"],
    reads: `[o.a, o.b, o.c, o.d, o.e, o.e?.x, o.z, "a" in o, "d" in o]`,
    stores: [["a", ["7", "undefined", "-2147483647", "-2147483646", "-2147483645", "-2147483644", "1.5"]], ["b", ['"t"', "undefined"]], ["c", ["true", "undefined"]], ["d", ["3", "undefined", "NaN", "-0"]], ["e", ["{ x: 2 }", "undefined"]], ["z", ["9"]]],
  }),
  "class-optional-defined": n => ({
    name: "class-optional-defined",
    decl: `class A${n} { a?: number; b?: string; c?: boolean; d?: number | null; e?: A${n}; z = 0; }`,
    make: () => `new A${n}()`,
    type: `A${n}`,
    keys: ["a", "b", "c", "d", "e", "z"],
    reads: `[o.a, o.b, o.c, o.d, o.e === o, o.e?.z, o.z]`,
    stores: [["a", ["7", "undefined", "1.5"]], ["b", ['"t"', "undefined"]], ["c", ["true", "undefined"]], ["d", ["3", "undefined", "null", "NaN"]], ["e", ["o", "undefined"]], ["z", ["9"]]],
  }),
  "interface-literal": n => ({
    name: "interface-literal",
    decl: `interface I${n} { a: number; b: string; c?: boolean; d: number | null; e?: number }\nfunction make${n}(w: number): I${n} { return w & 1 ? { a: 1, b: "s", d: null } : w & 2 ? { b: "s", a: 1, d: 2, c: true } : { a: 1, b: "s", c: false, d: 0.5, e: 3 }; }`,
    make: r => `make${n}(${r.int(4)})`,
    type: `I${n}`,
    keys: ["a", "b", "c", "d", "e"],
    reads: `[o.a, o.b, o.c, o.d, o.e]`,
    stores: [["a", ["7", "-0"]], ["b", ['"t"']], ["c", ["true", "undefined"]], ["d", ["3", "null", "NaN"]], ["e", ["1", "undefined"]]],
  }),
  "inferred-literal": n => ({
    name: "inferred-literal",
    decl: `function make${n}() { return { a: 1, b: "s", c: true, d: 1.5, e: { x: 1 } }; }`,
    make: () => `make${n}()`,
    type: `ReturnType<typeof make${n}>`,
    keys: ["a", "b", "c", "d", "e"],
    reads: `[o.a, o.b, o.c, o.d, o.e, o.e?.x]`,
    stores: [["a", ["7"]], ["b", ['"t"']], ["c", ["false"]], ["d", ["3"]], ["e", ["{ x: 2 }"]]],
  }),
  tagged: n => ({
    name: "tagged",
    decl: `type S${n} = { kind: "circle"; r: number } | { kind: "square"; s: number; t?: string } | { kind: "dot" };\nfunction make${n}(w: number): S${n} { return w === 0 ? { kind: "circle", r: 1 } : w === 1 ? { kind: "square", s: 2 } : w === 2 ? { kind: "square", s: 2, t: "t" } : { kind: "dot" }; }`,
    make: r => `make${n}(${r.int(4)})`,
    type: `S${n}`,
    keys: ["kind", "r", "s", "t"],
    reads: `[o.kind, o.kind === "circle" ? o.r : o.kind === "square" ? [o.s, o.t] : "dot"]`,
    stores: [],
  }),
  "literal-strings": n => ({
    name: "literal-strings",
    decl: `class A${n} { mode: "on" | "off" | "auto" = "on"; level: 0 | 1 | 2 | 3 = 2; flag: boolean | undefined = undefined; big: 1000 | 70000 | -5 = -5; maybe?: "x" | "y"; nul: "p" | null = null; }`,
    make: () => `new A${n}()`,
    type: `A${n}`,
    keys: ["mode", "level", "flag", "big", "maybe", "nul"],
    reads: `[o.mode, o.level, o.flag, o.big, o.maybe, o.nul, o.mode === "on", o.mode + "!", o.level + 1]`,
    stores: [["mode", ['"off"', '"auto"', '"on"']], ["level", ["0", "3"]], ["flag", ["true", "false", "undefined"]], ["big", ["1000", "70000"]], ["maybe", ['"x"', "undefined"]], ["nul", ['"p"', "null"]]],
  }),
  narrow: n => ({
    name: "narrow",
    decl: `class A${n} { u8: number; i8: number; u16: number; i16: number; u32: number; i32: number; f: number; constructor(x: number) { this.u8 = x & 255; this.i8 = (x << 24) >> 24; this.u16 = x & 65535; this.i16 = (x << 16) >> 16; this.u32 = x >>> 0; this.i32 = x | 0; this.f = Math.fround(x / 3); } }`,
    make: r => `new A${n}(${r.pick(["0", "-1", "255", "128", "65535", "32768", "2147483647", "-2147483648", "123456789"])})`,
    type: `A${n}`,
    keys: ["u8", "i8", "u16", "i16", "u32", "i32", "f"],
    reads: `[o.u8, o.i8, o.u16, o.i16, o.u32, o.i32, o.f]`,
    stores: [],
  }),
  private: n => ({
    name: "private",
    decl: `class A${n} { #p = 1; #q = "q"; a = 1; static s = 5; static #t = 6; static { A${n}.s = A${n}.#t + 1; } get acc() { return this.#p; } set acc(v: number) { this.#p = v; } #m() { return 1; } static has(o: object) { return #p in o; } peek() { return [this.#p, this.#q, this.#m()]; } poke(v: number) { this.#p = v; this.#q += "q"; } b = "s"; }`,
    make: () => `new A${n}()`,
    type: `A${n}`,
    keys: ["a", "b", "acc"],
    reads: `[o.a, o.b, o.acc, o.peek(), A${n}.has(o), A${n}.s]`,
    stores: [["a", ["7"]], ["b", ['"t"']], ["acc", ["5", "1.5"]]],
  }),
  symbols: n => ({
    name: "symbols",
    decl: `const own${n} = Symbol("own"); class A${n} { [own${n}] = 1; a = 2; [Symbol.toStringTag] = "Tagged"; ["computed1"] = 3; 0 = "zero"; 1.5 = "x"; b = "s"; 7 = 7; }`,
    make: () => `new A${n}()`,
    type: `A${n}`,
    keys: ["a", "b", "computed1", "0", "1.5", "7"],
    reads: `[o[own${n}], o.a, o[Symbol.toStringTag], o[0], o[1.5], o.b, o[7]]`,
    stores: [["a", ["7"]], ["b", ['"t"']]],
  }),
  derived: n => ({
    name: "derived",
    decl: `class Base${n} { a = 1; b = "s"; who() { return "base"; } } class Mid${n} extends Base${n} { c = true; a2 = 2; who() { return "mid"; } } class A${n} extends Mid${n} { d = 0.5; e?: number; }`,
    make: () => `new A${n}()`,
    type: `A${n}`,
    keys: ["a", "b", "c", "a2", "d", "e"],
    reads: `[o.a, o.b, o.c, o.a2, o.d, o.e, o.who?.(), o instanceof Base${n}]`,
    stores: [["a", ["7"]], ["b", ['"t"']], ["c", ["false"]], ["d", ["3"]], ["e", ["1", "undefined"]]],
  }),
  "constructor-function": n => ({
    name: "constructor-function",
    decl: `function F${n}(this: any, w: number) { this.a = 1; this.b = "s"; if (w) this.c = w; }\nF${n}.prototype.m = function () { return this.a; };`,
    make: r => `new (F${n} as any)(${r.int(2)})`,
    type: `any`,
    keys: ["a", "b", "c"],
    reads: `[o.a, o.b, o.c, o.m?.()]`,
    stores: [["a", ["7", '"x"']], ["b", ['"t"']]],
  }),
  "object-create": n => ({
    name: "object-create",
    decl: `const proto${n} = { inherited: 1, m() { return 2; }, set viaSetter(v: number) { (this as any).a = v; } };\nfunction make${n}() { const o = Object.create(proto${n}); o.a = 1; o.b = "s"; return o; }`,
    make: () => `make${n}()`,
    type: `any`,
    keys: ["a", "b", "inherited", "viaSetter"],
    reads: `[o.a, o.b, o.inherited, o.m?.()]`,
    stores: [["a", ["7"]], ["viaSetter", ["8"]]],
  }),
  "null-prototype": n => ({
    name: "null-prototype",
    decl: `function make${n}() { const o = Object.create(null); o.a = 1; o.b = "s"; return o; }`,
    make: () => `make${n}()`,
    type: `any`,
    keys: ["a", "b"],
    reads: `[o.a, o.b, o.toString]`,
    stores: [["a", ["7"]]],
  }),
  parsed: n => ({
    name: "parsed",
    decl: `interface T${n} { a: number; b: string; c: { d: number }[]; e?: boolean; f: number | null }\nfunction make${n}(w: number): T${n} { return JSON.parse(w ? '{"a":1,"b":"s","c":[{"d":1}],"e":true,"f":null}' : '{"f":2,"b":"s","extra":1,"a":1.5,"c":[]}') as T${n}; }`,
    make: r => `make${n}(${r.int(2)})`,
    type: `T${n}`,
    keys: ["a", "b", "c", "e", "f", "extra"],
    reads: `[o.a, o.b, o.c, o.c?.[0]?.d, o.e, o.f]`,
    stores: [["a", ["7"]], ["b", ['"t"']], ["e", ["false", "undefined"]], ["f", ["1", "null"]]],
  }),
  wide: n => ({
    name: "wide",
    decl: `class A${n} { ${Array.from({ length: 70 }, (_, i) => `f${i}: ${wideTypes[i % 6]} = ${wideValues[i % 6].replace("I", String(i))};`).join(" ")} }`,
    make: () => `new A${n}()`,
    type: `A${n}`,
    keys: ["f0", "f1", "f2", "f3", "f4", "f5", "f31", "f32", "f33", "f62", "f63", "f64", "f65", "f69"],
    reads: `[o.f0, o.f1, o.f2, o.f3, o.f4, o.f5, o.f31, o.f32, o.f33, o.f62, o.f63, o.f64, o.f65, o.f69]`,
    stores: [["f0", ["7"]], ["f63", ["1", "undefined"]], ["f64", ['"x"', "null"]], ["f69", ["1", "undefined"]]],
  }),
  arrows: n => ({
    name: "arrows",
    decl: `class A${n} { a = 1; f = () => this.a; g = function () { return 2; }; h = async () => 3; i = () => 4; b = "s"; }`,
    make: () => `new A${n}()`,
    type: `A${n}`,
    keys: ["a", "f", "g", "h", "i", "b"],
    reads: `[o.a, o.f?.(), o.g?.(), typeof o.h, o.i?.(), o.b, o.f === o.f, o.f?.name, o.i?.length]`,
    stores: [["a", ["7"]], ["f", ["() => 9"]], ["i", ["() => 8"]]],
  }),
  "literal-accessors": n => ({
    name: "literal-accessors",
    decl: `const above${n} = { up: 1 };\nfunction make${n}() { return { a: 1, get b() { return this.a + 1; }, set b(v: number) { this.a = v; }, c() { return 3; }, ["d" + ""]: 4, 5: "five", __proto__: above${n}, ...{ s1: 1, s2: 2 }, get only() { return 1; }, set sink(v: number) {} }; }`,
    make: () => `make${n}()`,
    type: `any`,
    keys: ["a", "b", "c", "d", "5", "s1", "s2", "only", "sink", "up"],
    reads: `[o.a, o.b, o.c?.(), o.d, o[5], o.s1, o.s2, o.only, o.sink, o.up]`,
    stores: [["a", ["7"]], ["b", ["8"]]],
  }),
  inner: n => ({
    name: "inner",
    decl: `class In${n} { x = 1; y = 2; } class A${n} { a = 1; in1 = new In${n}(); in2 = new In${n}(); b = "s"; }`,
    make: () => `new A${n}()`,
    type: `A${n}`,
    keys: ["a", "in1", "in2", "b"],
    reads: `[o.a, o.in1, o.in1?.x, o.in2?.y, o.b, o.in1 === o.in1, o.in1 === o.in2]`,
    stores: [["a", ["7"]], ["in1", [`new In${n}()`, "o.in2"]]],
  }),
  late: n => ({
    name: "late",
    decl: `function make${n}(w: number) { const o: any = { a: 1 }; o.b = "s"; if (w & 1) o.c = true; o.d = 1.5; if (w & 2) o.e = null; return o; }`,
    make: r => `make${n}(${r.int(4)})`,
    type: `any`,
    keys: ["a", "b", "c", "d", "e"],
    reads: `[o.a, o.b, o.c, o.d, o.e]`,
    stores: [["a", ["7"]], ["c", ["false"]]],
  }),
  "extends-array": n => ({
    name: "extends-array",
    decl: `class A${n} extends Array<number> { a = 1; b = "s"; }`,
    make: () => `A${n}.from([1, 2, 3]) as A${n}`,
    type: `A${n}`,
    keys: ["a", "b", "0", "1", "length"],
    reads: `[o.a, o.b, o[0], o.length, Array.isArray(o), o.length < 1000 && o.map?.(x => x) instanceof A${n}]`,
    stores: [["a", ["7"]], ["length", ["1", "5"]]],
  }),
  "extends-map": n => ({
    name: "extends-map",
    decl: `class A${n} extends Map<string, number> { a = 1; b = "s"; }`,
    make: () => `new A${n}([["k", 1]])`,
    type: `A${n}`,
    keys: ["a", "b", "size"],
    reads: `[o.a, o.b, Map.prototype.get.call(o, "k")]`,
    stores: [["a", ["7"]]],
  }),
  "extends-error": n => ({
    name: "extends-error",
    decl: `class A${n} extends Error { a = 1; code = "E"; constructor() { super("msg", { cause: 1 }); this.name = "A"; } }`,
    make: () => `new A${n}()`,
    type: `A${n}`,
    keys: ["a", "code", "message", "name", "cause"],
    reads: `[o.a, o.code, o.message, o.name, o.cause, typeof o.stack, String(o)]`,
    stores: [["a", ["7"]], ["message", ['"other"']]],
  }),
  "extends-object": n => ({
    name: "extends-object",
    decl: `class A${n} extends Object { a = 1; b = "s"; } `,
    make: () => `new A${n}()`,
    type: `A${n}`,
    keys: ["a", "b"],
    reads: `[o.a, o.b]`,
    stores: [["a", ["7"]]],
  }),
  "extends-null-returning": n => ({
    name: "extends-null-returning",
    decl: `class A${n} extends (null as any) { a = 1; constructor() { return Object.create(new.target.prototype); super(); } }`,
    make: () => `new A${n}()`,
    type: `any`,
    keys: ["a"],
    reads: `[o.a]`,
    stores: [],
  }),
  "extends-function": n => ({
    name: "extends-function",
    decl: `function Old${n}(this: any) { this.old = 1; }\nOld${n}.prototype.om = function () { return "om"; };\nclass A${n} extends (Old${n} as any) { a = 1; b = "s"; }`,
    make: () => `new A${n}()`,
    type: `any`,
    keys: ["old", "a", "b"],
    reads: `[o.old, o.a, o.b, o.om?.()]`,
    stores: [["a", ["7"]]],
  }),
  "extends-typed-array": n => ({
    name: "extends-typed-array",
    decl: `class A${n} extends Uint8Array { a = 1; b = "s"; }`,
    make: () => `new A${n}(3)`,
    type: `A${n}`,
    keys: ["a", "b", "0", "3"],
    reads: `[o.a, o.b, o[0], o.length]`,
    stores: [["a", ["7"]]],
  }),

  "class-object-made-again": n => ({
    name: "class-object-made-again",
    decl: `function make${n}(): any { return class K { static s = 1; static t = "s"; static m() { return 1; } static get acc() { return 2; } static set acc(v: number) { console.log("static setter", v); } static #p = 3; static peek() { return K.#p; } inst = 1; im() { return 4; } }; }`,
    make: () => `make${n}()`,
    type: `any`,
    keys: ["s", "t", "m", "acc", "name", "length", "prototype", "peek"],
    reads: `[o.s, o.t, o.m?.(), o.acc, o.name, o.length, typeof o.prototype, o.peek?.(), new o().inst, new o().im?.()]`,
    stores: [["s", ["7", '"x"']], ["acc", ["8"]]],
  }),
  "class-object": n => ({
    name: "class-object",
    decl: ["a", "b", "c"].map(l => `class K${n}${l} { static s = 1; static t = "s"; static m() { return 1; } static get acc() { return 2; } static set acc(v: number) { console.log("static setter", v); } static #p = 3; static peek() { return K${n}${l}.#p; } inst = 1; im() { return 4; } }`).join("\n"),
    make: r => `K${n}${r.pick(["a", "b", "c"])}`,
    type: `any`,
    keys: ["s", "t", "m", "acc", "name", "length", "prototype", "peek"],
    reads: `[o.s, o.t, o.m?.(), o.acc, o.name, o.length, typeof o.prototype, o.peek?.(), new o().inst, new o().im?.()]`,
    stores: [["s", ["7", '"x"']], ["acc", ["8"]]],
  }),
  "class-object-typed": n => ({
    name: "class-object-typed",
    decl: `class K${n} { static s = 1; static t = "s"; static u?: number; static m() { return K${n}.s; } static get acc() { return 2; } static set acc(v: number) { console.log("static setter", v); } inst = 1; }`,
    make: () => `K${n}`,
    type: `typeof K${n}`,
    keys: ["s", "t", "u", "m", "acc", "name", "length", "prototype"],
    reads: `[o.s, o.t, o.u, o.m?.(), o.acc, o.name, o.length, K${n}.s, K${n}.t, K${n}.m?.(), new K${n}().inst]`,
    stores: [["s", ["7"]], ["acc", ["8"]], ["u", ["1", "undefined"]]],
  }),
  "class-heir-object": n => ({
    name: "class-heir-object",
    decl: `class B${n} { static s = 1; static m() { return "base m"; } static get acc() { return "base acc"; } static over() { return "base over"; } bi = 1; }\n` + ["a", "b"].map(l => `class K${n}${l} extends B${n} { static t = "s"; static over() { return "heir over " + super.over(); } static viaSuper() { return [super.s, super.m(), super.acc]; } }`).join("\n"),
    make: r => r.pick([`K${n}a`, `K${n}b`, `K${n}a`, `B${n}`]),
    type: `any`,
    keys: ["s", "t", "m", "acc", "over", "viaSuper", "name", "prototype"],
    reads: `[o.s, o.t, o.m?.(), o.acc, o.over?.(), o.viaSuper?.(), o.name, Object.getPrototypeOf(o) === B${n}, new o().bi]`,
    stores: [["s", ["7"]], ["t", ['"u"']]],
  }),
  "class-prototype": n => ({
    name: "class-prototype",
    decl: ["a", "b"].map(l => `class K${n}${l} { f = 1; im() { return this.f; } get acc() { return "acc"; } set acc(v: unknown) { console.log("setter", show(v)); } other() { return 2; } static sm() { return 3; } *gen() { yield 1; } async am() { return 5; } }`).join("\n"),
    make: r => `K${n}${r.pick(["a", "b"])}.prototype`,
    type: `any`,
    keys: ["constructor", "im", "acc", "other", "gen", "am", "f"],
    reads: `[typeof o.constructor, o.im?.(), o.acc, o.other?.(), typeof o.gen, new K${n}a().im?.(), new K${n}a().acc, new K${n}b().other?.(), new K${n}a().f]`,
    stores: [["im", ["() => 9", "1"]], ["acc", ["8"]]],
  }),
  "function-object": n => ({
    name: "function-object",
    decl: `function make${n}(w: number): any { function named(a: number, b: number) { return a + b; } const list = [named, function () { return 1; }, () => 2, async () => 3, function* g() { yield 4; }, { method(x: number) { return x; } }.method, named.bind(null, 1), class {}, async function* ag() {}, { get acc() { return 1; } }]; const f: any = list[w]; return w === 9 ? Object.getOwnPropertyDescriptor(f, "acc")!.get : f; }`,
    make: r => `make${n}(${r.int(10)})`,
    type: `any`,
    keys: ["name", "length", "prototype", "caller", "arguments", "p"],
    reads: `[o.name, o.length, typeof o.prototype, o.p, typeof o, Object.hasOwn(o, "prototype")]`,
    stores: [["p", ["7", '"x"']], ["name", ['"renamed"']]],
  }),
};

const strangeKeys = ["0", "1", "2", "-0", "-1", "4294967294", "4294967295", "4294967296", "1e3", "01", "1.5", "", " ", "__proto__", "constructor", "toString", "valueOf", "then", "toJSON", "length", "name", "prototype", "hasOwnProperty", "a b", "é", "😀", "NaN", "Infinity", "undefined", "null"];
const symbolKeys = ["localSymbol", "Symbol.iterator", "Symbol.toPrimitive", "Symbol.toStringTag", 'Symbol.for("registered")', "Symbol.hasInstance", "Symbol.unscopables", "Symbol.isConcatSpreadable"];
const freshKeys = ["n0", "n1", "n2", "n3", "n4"];
const values = ["1", "-1", "0", "-0", "1.5", "NaN", "2147483647", "-2147483648", "-2147483647", "-2147483646", "-2147483645", "-2147483644", "4294967295", "2 ** 53", "1e308", "Infinity", '"s"', '""', '"on"', '"off"', '"zzz"', "true", "false", "null", "undefined", "{}", "[]", "[1]", "() => 1", "function (this: any) { return this; }", "Symbol.iterator", "10n", "new Date(0)", "/x/g", "{ inner: 2 }", "255", "256", "-128", "-129", "65536", "chosenNaN(0x7ffa)", "chosenNaN(0x7ffb)", "chosenNaN(0x7ffc)", "chosenNaN(0xfff8)"];

export function program(seed: number, options: { births?: string[]; steps?: number; scenarios?: number } = {}): string {
  const r = new Random(seed);
  const parts: string[] = [
    look,
    `const localSymbol = Symbol("local");`,
    `function chosenNaN(high: number): number { const b = new DataView(new ArrayBuffer(8)); b.setUint16(0, high); return b.getFloat64(0); }`,
    `function report(label: string, f: () => unknown): void { console.log(label + " | " + attempt(f)); }`,
  ];
  const names = options.births ?? Object.keys(births);
  const scenarios = options.scenarios ?? 2;
  for (let s = 0; s < scenarios; s++) {
    const n = String(s);
    const birth = births[r.pick(names)](n);
    const objects = ["x", "y", "z"].slice(0, 2 + r.int(2));
    const key = (): { text: string; isSymbol: boolean } => {
      const w = r.int(100);
      if (w < 55) return { text: r.pick(birth.keys), isSymbol: false };
      if (w < 70) return { text: r.pick(freshKeys), isSymbol: false };
      if (w < 90) return { text: r.pick(strangeKeys), isSymbol: false };
      return { text: r.pick(symbolKeys), isSymbol: true };
    };
    const keyExpression = (k: { text: string; isSymbol: boolean }) => (k.isSymbol ? k.text : r.chance(0.5) ? JSON.stringify(k.text) : `hide(${JSON.stringify(k.text)})`);
    const hiddenKey = () => { const k = key(); return `hide(${k.isSymbol ? k.text : JSON.stringify(k.text)}) as unknown as string`; };
    const at = (u: string, k: { text: string; isSymbol: boolean }) => (!k.isSymbol && /^[a-z_][a-zA-Z0-9_]*$/.test(k.text) && r.chance(0.6) ? `${u}.${k.text}` : `${u}[${keyExpression(k)}]`);
    const value = () => r.pick(values);
    const prototypes = (k: string) => [
      "null", "Object.prototype", `otherProto${n}`, `{ set ${JSON.stringify(k)}(v: unknown) { console.log("setter above", show(v)); } }`, `Object.freeze({ ${JSON.stringify(k)}: "frozen above" })`,
      "new Proxy({}, {})", `loggingProxy${n}`, "Array.prototype", "Function.prototype", `Object.getPrototypeOf(${birth.make(r)})`, `{ get ${JSON.stringify(k)}() { return "getter above"; } }`, `Object.create(null)`,
    ];
    const dataDescriptor = () => {
      const f: string[] = [];
      if (r.chance(0.6)) f.push(`value: ${value()}`);
      if (r.chance(0.5)) f.push(`writable: ${r.chance(0.5)}`);
      if (r.chance(0.5)) f.push(`enumerable: ${r.chance(0.5)}`);
      if (r.chance(0.5)) f.push(`configurable: ${r.chance(0.5)}`);
      return `{ ${f.join(", ")} }`;
    };
    const accessorDescriptor = () => {
      const f: string[] = [];
      if (r.chance(0.7)) f.push(r.chance(0.85) ? `get() { return "got"; }` : "get: undefined");
      if (r.chance(0.5)) f.push(r.chance(0.85) ? `set(v: unknown) { console.log("set", show(v)); }` : "set: undefined");
      if (!f.length) f.push(`get() { return "got"; }`);
      if (r.chance(0.5)) f.push(`enumerable: ${r.chance(0.5)}`);
      if (r.chance(0.5)) f.push(`configurable: ${r.chance(0.5)}`);
      return `{ ${f.join(", ")} }`;
    };
    const ops: [number, (u: string, t: string) => string][] = [
      [10, u => `${at(u, key())} = ${value()}`],
      [10, u => `return delete ${at(u, key())}`],
      [5, u => { const k = key(); return `delete ${at(u, k)}; ${at(u, k)} = ${value()}`; }],
      [8, u => `Object.defineProperty(${u}, ${keyExpression(key())}, ${dataDescriptor()})`],
      [6, u => `Object.defineProperty(${u}, ${keyExpression(key())}, ${accessorDescriptor()})`],
      [3, u => `Object.${r.pick(["freeze", "seal", "preventExtensions"])}(${u})`],
      [5, u => `Object.setPrototypeOf(${u}, ${r.pick(prototypes(r.pick(birth.keys)))})`],
      [2, u => `${u}.__proto__ = ${r.pick(prototypes(r.pick(birth.keys)))}`],
      [4, u => `Object.assign(${u}, { ${Array.from({ length: 1 + r.int(3) }, () => `[${hiddenKey()}]: ${value()}`).join(", ")} })`],
      [3, u => `return Reflect.set(${u}, ${keyExpression(key())}, ${value()})`],
      [3, u => `return Reflect.set({}, ${keyExpression(key())}, ${value()}, ${u})`],
      [2, u => `return Reflect.set(Object.create(${u}), ${keyExpression(key())}, ${value()})`],
      [3, u => `return Reflect.defineProperty(${u}, ${keyExpression(key())}, ${r.chance(0.5) ? dataDescriptor() : accessorDescriptor()})`],
      [3, u => `return Reflect.deleteProperty(${u}, ${keyExpression(key())})`],
      [2, u => `${u}.__defineGetter__(${keyExpression(key())}, () => "defined getter")`],
      [2, u => `${u}.__defineSetter__(${keyExpression(key())}, (v: unknown) => { console.log("defined setter", show(v)); })`],
      [3, u => { const c = r.pick([3, 20, 70, 300, 150]); return `for (let i = 0; i < ${c}; i++) ${u}["k" + i] = i; ${r.chance(0.5) ? `for (let i = 0; i < ${c}; i += 2) delete ${u}["k" + i];` : ""}`; }],
      [3, u => `new Stamp${n}(${u}); return [Stamp${n}.has(${u}), Stamp${n}.read(${u})]`],
      [3, u => { const order = r.shuffle(birth.keys); return `const kept: Record<string, unknown> = {}; for (const k of ${JSON.stringify(r.shuffle(birth.keys))}) { kept[k] = ${u}[k]; delete ${u}[k]; } for (const k of ${JSON.stringify(order)}) ${u}[k] = kept[k];`; }],
      [2, u => `Object.defineProperties(${u}, { [${hiddenKey()}]: ${dataDescriptor()}, [${hiddenKey()}]: ${accessorDescriptor()} })`],
      [2, () => `Bun.gc(true)`],
      [3, u => `const seen: string[] = []; for (const k in ${u}) { seen.push(k); delete ${at(u, key())}; ${at(u, key())} = ${value()}; } return seen`],
      [2, u => `const child = Object.create(${u}); const before = ${at("child", key())}; ${at(u, key())} = ${value()}; return [before, Object.keys(child), ${at("child", key())}]`],
      [2, u => `if (!(${u}.length <= 100)) ${u}.length = 3; return Array.prototype.${r.pick(["push.call(U, 1, 2)", "pop.call(U)", "reverse.call(U)", "unshift.call(U, 9)", "fill.call(U, 3, 0, 2)", "splice.call(U, 0, 1)", "sort.call(U)", "shift.call(U)", "copyWithin.call(U, 0, 1)"]).replace("U", u)}`],
      [3, u => { const k = key(); return `const p = new Proxy(${u}, {}); ${r.pick([`${at("p", k)} = ${value()}`, `return delete ${at("p", k)}`, `Object.defineProperty(p, ${keyExpression(k)}, ${dataDescriptor()})`, `Object.freeze(p)`, `return Reflect.ownKeys(p)`, `return Object.getOwnPropertyDescriptor(p, ${keyExpression(k)})`, `Object.preventExtensions(p)`])}`; }],
      [4, (u, t) => (birth.stores.length ? (() => { const [k, vs] = r.pick(birth.stores); return `store${n}_${k}(${t}, ${r.pick(vs).replace(/\bo\b/g, t)})`; })() : `${at(u, key())} = ${value()}`)],
      [2, u => `const copy = Object.assign(Object.create(Object.getPrototypeOf(${u})), ${u}); return describe(copy)`],
      [2, (u, t) => `return [new WeakRef(${t}).deref() === ${t}, new WeakMap([[${t}, 1]]).get(${t}), new WeakSet([${t}]).has(${t})]`],
      [2, u => `${u}.toJSON = function (this: any) { delete ${at("this", key())}; return { ...this, toJSON: undefined }; }; return JSON.stringify(${u})`],
      [2, u => `return JSON.stringify(${u}, ${JSON.stringify(r.shuffle([...birth.keys, "n0", "0"]).slice(0, 3))})`],
      [1, u => `Object.defineProperty(${u}, ${keyExpression(key())}, { get() { delete ${at("this", key())}; return 1; }, enumerable: true, configurable: true })`],
      [2, u => `const { ${birth.keys.filter(k => /^[a-z]\w*$/.test(k)).slice(0, 2).map(k => `${k}: _${k}`).join(", ")}, ...rest } = ${u}; return rest`],
    ];
    const total = ops.reduce((a, [w]) => a + w, 0);
    const drawOp = () => { let w = r.int(total); for (const [weight, op] of ops) { if ((w -= weight) < 0) return op; } return ops[0][1]; };

    parts.push(`// scenario ${n}: ${birth.name}`);
    parts.push(birth.decl);
    parts.push(`const otherProto${n} = { other: "other", get viaGetter() { return "via getter"; } };`);
    parts.push(`const loggingProxy${n} = new Proxy({}, { get(t, k, rc) { console.log("proxy get", String(k)); return undefined; }, has(t, k) { console.log("proxy has", String(k)); return false; }, set(t, k, v, rc) { console.log("proxy set", String(k)); return Reflect.defineProperty(rc, k, { value: v, writable: true, enumerable: true, configurable: true }); } });`);
    parts.push(`class Return${n} { constructor(o: object) { return o; } }\nclass Stamp${n} extends Return${n} { #stamp = 1; stamped = "yes"; static has(o: object) { return #stamp in o; } static read(o: any) { return o.#stamp; } }`);
    parts.push(`function reads${n}(o: ${birth.type}): unknown { return ${birth.reads}; }`);
    for (const [k] of birth.stores) parts.push(`function store${n}_${k}(o: ${birth.type}, v: ${birth.type === "any" ? "any" : `${birth.type}[${JSON.stringify(k)}]`}): void { o.${k} = v; }`);
    const body: string[] = [];
    if (r.chance(0.6)) body.push(`for (let i = 0; i < ${r.pick([3, 50, 2000])}; i++) { const w = ${birth.make(r)}; reads${n}(w); if (i === 0) look("${n}.warm", w); }`);
    for (const o of objects) body.push(`const ${o}: ${birth.type} = ${birth.make(r)}; const ${o}u: any = ${r.chance(0.5) ? o : `hide(${o})`};`);
    const steps = options.steps ?? 3 + r.int(6);
    for (let step = 0; step < steps; step++) {
      const o = r.pick(objects);
      const text = drawOp()(`${o}u`, o);
      body.push(`report("${n}.${step} ${o} op", () => { ${text}; });`);
      for (const other of objects) {
        if (other !== o && r.chance(0.5)) continue;
        body.push(`report("${n}.${step} ${other} reads", () => reads${n}(${other}));`);
        body.push(`look("${n}.${step} ${other}", ${other});`);
      }
    }
    body.push(`{ const w = ${birth.make(r)}; report("${n}.end fresh reads", () => reads${n}(w)); look("${n}.end fresh", w); }`);
    parts.push(`function scenario${n}() {\n  ${body.join("\n  ")}\n}\nscenario${n}();`);
  }
  return parts.join("\n") + "\n";
}
