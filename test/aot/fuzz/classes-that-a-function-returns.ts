// A function returns a class expression. Every way to write the function x every way to use what it returns x everything that the class holds, in a module, in a CommonJS file, in TypeScript that nobody checks, and with the function in another file than its uses:
// each once, twenty to a program, each in a block of its own. Each call of the function makes a class of its own: private names, static fields and the variables of that call belong to it alone.
// So where a use makes two classes, both are looked at, and each is asked about the instances of the other.

/** What `isNoTypeScript` is JavaScript that TypeScript's grammar refuses, also in a file that nobody checks: the TypeScript programs leave it out. */
/** `Base` and `kept` are a parameter and a variable of the function. `sees` looks at one class `C`, `across` at two, `A` and `B`. `outside` stands ahead of the function. */
const held: readonly { name: string; outside?: string; text: string; sees: string; across?: string; isNoTypeScript?: true }[] = [
  { name: "an async method", text: "class extends Base { #p = 3; async later() { return this.#p; } }", sees: "typeof new C().later().then" },
  { name: "closures of a block", text: "class extends Base { static #n = 3; static { this.get = () => this.#n; this.set = v => { this.#n = v; }; } }", sees: "[C.get(), C.set(8), C.get()]" },
  { name: "a loop in a block", text: "class extends Base { static #k = 0; static { for (let i = 0; i < 5; i++) this.#k += i; this.t = this.#k; } }", sees: "C.t" },
  { name: "a function in a block", text: "class extends Base { static #k = 4; static { function inner(c) { return c.#k; } this.t = inner(this); } }", sees: "C.t" },
  { name: "a block reads a private field of instances", text: "class extends Base { #x = 6; static { this.peek = o => o.#x; } }", sees: "C.peek(new C())" },
  { name: "try, catch and finally in a block", text: "class extends Base { static #k = 4; static { try { this.t = this.#k; throw 1; } catch (e) { this.u = e + this.#k; } finally { this.w = this.#k * 2; } } }", sees: "[C.t, C.u, C.w]" },
  { name: "a block writes a private static field that a method reads", text: "class extends Base { static #n = 1; static { this.#n = 40; } static take() { return this.#n++; } }", sees: "[C.take(), C.take()]" },
  { name: "the name of the class in a block", text: "class K extends Base { static #c = 2; static { K.t = K.#c; } static again() { return K.#c; } }", sees: "[C.t, C.again()]" },
  { name: "an arrow in a field", text: "class extends Base { #p = 5; get = () => this.#p; }", sees: "new C().get()" },
  { name: "a generator method", text: "class extends Base { #p = [1, 2]; *each() { yield* this.#p; } }", sees: "[...new C().each()]" },
  { name: "a static getter and setter", text: "class extends Base { static #s = 1; static get s() { return this.#s; } static set s(v) { this.#s = v; } static { this.s = 12; } }", sees: "C.s" },
  { name: "a private accessor", text: "class extends Base { #v = 1; get #a() { return this.#v; } set #a(x) { this.#v = x * 2; } run() { this.#a = 4; return this.#a; } }", sees: "new C().run()" },
  { name: "a private field", text: "class extends Base { #x = 7; read() { return this.#x; } write(v) { this.#x = v; return this; } }", sees: "[new C().read(), new C().write(3).read()]" },
  { name: "a private method", text: "class extends Base { #m() { return 11; } call() { return this.#m(); } static has(o) { return #m in o; } }", sees: "[new C().call(), C.has(new C()), C.has({})]", across: "[A.has(new B()), B.has(new A())]" },
  { name: "an instance made in a block", text: "class K extends Base { #p = 1; static first; static { K.first = new K(); K.seen = K.first.#p; } }", sees: "[C.seen, C.first instanceof C]" },
  { name: "private names asked for in a block", text: "class extends Base { static #s; #i = 1; static { this.t = #s in this; this.u = #i in this; this.w = #i in new this(); } }", sees: "[C.t, C.u, C.w]" },
  { name: "static fields that read this", text: "class extends Base { static a = 1; static b = this.a + 1; static { this.c = this.b + 1; } }", sees: "[C.a, C.b, C.c]" },
  { name: "a private static accessor in a block", text: "class extends Base { static #v = 2; static get #a() { return this.#v; } static set #a(x) { this.#v = x; } static { this.#a = 9; this.t = this.#a; } }", sees: "C.t" },
  { name: "a private static field in a block", text: "class extends Base { static #c = 1; static { this.t = this.#c; } }", sees: "C.t" },
  { name: "a private static method in a block", text: "class extends Base { static #m() { return 5; } static { this.t = this.#m(); } }", sees: "C.t" },
  { name: "super in a block", text: "class extends Base { static { this.t = typeof super.toString; this.u = super.name === Base.name; } }", sees: "[C.t, C.u]" },
  { name: "two blocks", text: "class extends Base { static #a = 1; static { this.#a += 10; } static b = this.#a; static { this.#a += 100; this.c = this.#a; } }", sees: "[C.b, C.c]" },

  { name: "a block writes a variable that a field reads", text: "class extends Base { static { kept = 100; } id = kept++; }", sees: "[new C().id, new C().id]" },
  { name: "a block writes a variable that a static method reads", text: "class extends Base { static { kept = 50; } static read() { return kept; } }", sees: "C.read()" },
  { name: "a method writes a variable that a static method reads", text: "class extends Base { bump() { return ++kept; } static peek() { return kept; } }", sees: "[new C().bump(), C.peek(), new C().bump(), C.peek()]" },
  { name: "static fields on both sides of a block read a variable", text: "class extends Base { static a = kept; static { kept += 6; } static b = kept; }", sees: "[C.a, C.b]" },
  { name: "a key computed from a variable", text: 'class extends Base { ["m" + kept]() { return kept; } static names() { return Object.getOwnPropertyNames(this.prototype); } }', sees: "C.names()" },
  { name: "a static key whose computation counts", text: 'class extends Base { static [(kept++, "k")] = kept; }', sees: "C.k" },
  { name: "a closure of a block leaves through a variable outside", outside: "let out;", text: "class extends Base { static { out = () => ++kept; } peek() { return kept; } }", sees: "[out(), out(), new C().peek()]" },
  { name: "a block keeps an arrow with its this in a variable", text: 'class extends Base { static tag = "t"; static { kept = () => this.tag; } static who() { return kept(); } }', sees: "C.who()" },
  { name: "a method returns a closure over a private field and a variable", text: "class extends Base { #v = 2; later() { return () => this.#v + kept; } }", sees: "new C().later()()" },
  { name: "an accessor over a variable", text: "class extends Base { set v(x) { kept = x; } get v() { return kept; } }", sees: "(o => [o.v, (o.v = 9), o.v, new C().v])(new C())" },
  { name: "a static field holds a list with a variable", text: "class extends Base { static s = [kept]; }", sees: '[C.s, Object.hasOwn(C, "s")]' },
  { name: "what is an instance is decided by a variable", text: "class extends Base { static [Symbol.hasInstance](o) { return o === kept; } }", sees: "[1 instanceof C, 2 instanceof C]" },
  { name: "a block that throws and catches", text: 'class extends Base { static { try { if (kept > 0) throw new RangeError("r"); this.ok = 1; } catch (e) { this.ok = e.name; } } }', sees: "C.ok" },

  { name: "a getter reads a private field", text: "class extends Base { #p = 2; get p() { return this.#p; } }", sees: "new C().p" },
  { name: "a class in a block", text: "class extends Base { static { this.Inner = class { static #z = 3; static z() { return this.#z; } }; } }", sees: "C.Inner.z()" },
  { name: "a class in a static field reads a private name of the outer one", text: "class K extends Base { static #s = 4; static Inner = class { read() { return K.#s; } }; }", sees: "new C.Inner().read()" },
  { name: "new.target in the constructor", text: "class extends Base { constructor() { super(); this.same = new.target === this.constructor; } }", sees: "new C().same" },
  { name: "a constructor stores a private field", text: "class extends Base { #a; constructor(v = 5) { super(); this.#a = v; } a() { return this.#a; } }", sees: "[new C().a(), new C(6).a()]" },
  { name: "super in a field", text: "class extends Base { same = super.toString === Base.prototype.toString; }", sees: "new C().same" },
  { name: "super in a static method", text: "class extends Base { static up() { return super.name === Base.name; } }", sees: "C.up()" },
  { name: "an iterator over a private list", text: "class extends Base { #l = [1, 2]; [Symbol.iterator]() { return this.#l[Symbol.iterator](); } }", sees: "[...new C()]" },
  { name: "a method calls a private static method by the name of the class", text: "class K extends Base { static #h(x) { return x * 2; } twice(x) { return K.#h(x); } }", sees: "new C().twice(4)" },
  { name: "a private name is asked of instances", text: "class extends Base { #b = 1; static is(o) { return #b in o; } }", sees: "[C.is(new C()), C.is({})]", across: "[A.is(new B()), B.is(new A())]" },
  { name: "a static arrow reads a private static field", text: "class extends Base { static #q = 9; static get = () => this.#q; }", sees: "C.get()" },
  { name: "fields that read earlier fields", text: "class extends Base { #a = 1; b = this.#a + 1; #c = this.b + 1; c() { return this.#c; } }", sees: "[new C().b, new C().c()]" },
  { name: "a pattern stores into private static fields", text: "class extends Base { static #x; static #y; static { [this.#x, this.#y] = [1, 2]; this.t = this.#x + this.#y; } }", sees: "C.t" },
  { name: "a private field behind an optional chain", text: "class extends Base { #o = { v: 1 }; read(o) { return o?.#o.v; } }", sees: "[new C().read(new C()), new C().read(null)]", isNoTypeScript: true },
  { name: "a private generator", text: "class extends Base { *#g() { yield 1; yield 2; } all() { return [...this.#g()]; } }", sees: "new C().all()" },
  { name: "instances counted in a private static field", text: "class K extends Base { static #n = 0; constructor() { super(); K.#n++; } static count() { return K.#n; } }", sees: "[new C() && C.count(), new C() && C.count()]", across: "[A.count(), B.count()]" },
  { name: "a static field holds an instance", text: "class K extends Base { #p = 3; static one = new K(); static p() { return K.one.#p; } }", sees: "[C.p(), C.one instanceof C]" },
  { name: "the text of an instance comes from a private field", text: 'class extends Base { #t = "x"; toString() { return this.#t; } }', sees: '[String(new C()), "" + new C()]' },
  { name: "a private method is stored to", text: "class extends Base { #m() {} attempt() { try { this.#m = 1; return 0; } catch (e) { return e.constructor.name; } } }", sees: "new C().attempt()" },
  { name: "a private field of another class's instance is read", text: "class extends Base { #f = 1; static read(o) { try { return o.#f; } catch (e) { return e.constructor.name; } } }", sees: "[C.read(new C()), C.read({})]", across: "[A.read(new B()), B.read(new A())]" },

  { name: "a map outside is read through the helper", outside: "const state = new WeakMap();", text: 'class extends Base { constructor(v) { super(); state.set(this, v); } read() { return __classPrivateFieldGet(this, state, "f"); } }', sees: "[new C(7).read(), new C(8).read()]", across: "[A.prototype.read.call(new B(2)), B.prototype.read.call(new A(1))]" },
  { name: "a map outside is given a stranger", outside: "const state = new WeakMap();", text: 'class extends Base { constructor(v) { super(); state.set(this, v); } read() { return __classPrivateFieldGet(this, state, "f"); } }', sees: '(s => (state.set(s, "stranger"), [C.prototype.read.call(s), new C(1).read()]))({})' },
  { name: "a map outside is written through the helper", outside: "const state = new WeakMap();", text: 'class extends Base { constructor(v) { super(); state.set(this, 0); __classPrivateFieldSet(this, state, v, "f"); } read() { return __classPrivateFieldGet(this, state, "f"); } }', sees: "[new C(3).read(), (o => (state.set(o, 6), o.read()))(new C(5))]" },
  { name: "a set outside is asked through the helper and changed outside", outside: "const marks = new WeakSet();", text: "class extends Base { is() { return __classPrivateFieldIn(marks, this); } }", sees: "(o => [o.is(), (marks.add(o), o.is()), (marks.delete(o), o.is())])(new C())" },
  { name: "a map declared outside is made where the class is", outside: "let state;", text: 'class extends ((state = new WeakMap()), Base) { constructor(v) { super(); state.set(this, v); } read() { return __classPrivateFieldGet(this, state, "f"); } }', sees: "(o => [o.read(), state.get(o), (state.set(o, 6), o.read())])(new C(5))" },
  { name: "a method outside behind a set of instances", outside: "const brand = new WeakSet(), step = function () { return 3; };", text: 'class extends Base { constructor() { super(); brand.add(this); } run() { return __classPrivateFieldGet(this, brand, "m", step).call(this); } }', sees: "new C().run()" },
  { name: "a map outside without a helper", outside: "const state = new WeakMap();", text: "class extends Base { constructor(v) { super(); state.set(this, v); } read() { return state.get(this); } }", sees: "[new C(4).read(), state.has(new C(1)), state.has({})]" },
  { name: "a static value outside behind the helper", outside: "const holder = { value: 5 };", text: 'class K extends Base { static read() { return __classPrivateFieldGet(K, K, "f", holder); } }', sees: "C.read()" },
]; // prettier-ignore

/** What `isAwaited` answers with a promise: each call of it is awaited, which a CommonJS file cannot do at its top, so those programs leave it out. */
const functions: readonly { name: string; text: (made: string) => string; isAwaited?: true }[] = [
  { name: "an arrow", text: made => `const make = (Base = Object, kept = 1) => ${made};` },
  { name: "an arrow with a body", text: made => `const make = (Base = Object) => { let kept = 1; return ${made}; };` },
  { name: "a function expression", text: made => `const make = function (Base = Object) { let kept = 1; return ${made}; };` },
  { name: "a function declaration", text: made => `function make(Base = Object) { let kept = 1; return ${made}; }` },
  { name: "an arrow of a function that ran", text: made => `const make = (() => { let kept = 1; return (Base = Object) => ${made}; })();` },
  { name: "through a constant", text: made => `const make = (Base = Object) => { let kept = 1; const Made = ${made}; return Made; };` },
  { name: "a method of a literal", text: made => `const make = { make(Base = Object) { let kept = 1; return ${made}; } }.make;` },
  { name: "a static method", text: made => `class Maker { static make(Base = Object) { let kept = 1; return ${made}; } }\n  const make = Maker.make;` },
  { name: "one of two returns", text: made => `const make = (Base = Object, other = false) => { let kept = 1; if (other) return class {}; return ${made}; };` },
  { name: "out of a literal", text: made => `const make = (Base = Object) => { let kept = 1; return { made: ${made} }.made; };` },
  { name: "an arrow inside", text: made => `const make = (Base = Object) => { let kept = 1; const inner = () => ${made}; return inner(); };` },
  { name: "out of a try", text: made => `const make = (Base = Object) => { let kept = 1; try { return ${made}; } finally { kept += 0; } };` },
  { name: "a generator", text: made => `function* makes(Base = Object) { let kept = 1; yield ${made}; }\n  const make = Base => makes(Base).next().value;` },
  { name: "an async function", text: made => `const make = async (Base = Object) => { let kept = 1; return ${made}; };`, isAwaited: true },
]; // prettier-ignore

/** Each declares `C`; one that `makesTwo` declares `C0`, made first, as well. `awaited` is the text for a function that answers with a promise, where putting `await` ahead of each call does not give it. */
const uses: readonly { name: string; text: string; awaited?: string; makesTwo?: true }[] = [
  { name: "kept in a constant", text: "const C = make();" },
  { name: "extended", text: "class S extends make() {}\n  const C = S;" },
  { name: "extended by a class with a field", text: "class S extends make() { own = 1; }\n  const C = S;" },
  { name: "made twice", text: "const C0 = make();\n  const C = make();", makesTwo: true },
  { name: "extended twice", text: "class S0 extends make() {}\n  class S extends make() {}\n  const C0 = S0, C = S;", makesTwo: true },
  { name: "over a class of the program", text: 'class Root { root() { return "root"; } }\n  const C = make(Root);' },
  { name: "over what it made", text: "const C = make(make());", awaited: "const C = await make(await make());" },
  { name: "made in a loop", text: "let C;\n  for (let turn = 0; turn < 3; turn++) C = make();" },
  { name: "called by another function", text: "const call = f => f();\n  const C = call(make);", awaited: "const call = f => f();\n  const C = await call(make);" },
  { name: "looked at after another was made", text: "const C = make();\n  make();" },
]; // prettier-ignore

const kinds: readonly { file: string; isInTwoFiles?: true }[] = [
  { file: "main.mjs" },
  { file: "main.cjs" },
  { file: "main.ts" },
  { file: "main.mjs", isInTwoFiles: true },
];

export const inOne = 20;
/** What the class holds moves fastest, so that a program holds many different classes. */
const caseOf = (number: number) => ({
  holds: held[number % held.length],
  use: uses[Math.floor(number / held.length) % uses.length],
  written: functions[Math.floor(number / (held.length * uses.length))],
});
const laidOut = kinds.map(kind => ({
  kind,
  cases: Array.from({ length: functions.length * uses.length * held.length }, (_, number) => caseOf(number)).filter(
    ({ holds, written }) =>
      !(holds.isNoTypeScript && kind.file.endsWith(".ts")) && !(written.isAwaited && kind.file.endsWith(".cjs")),
  ),
}));
export const programs = laidOut.reduce((sum, { cases }) => sum + Math.ceil(cases.length / inOne), 0);

const helpers = `var __classPrivateFieldGet = function (receiver, state, kind, f) { if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter"); if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it"); return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver); };
var __classPrivateFieldSet = function (receiver, state, value, kind, f) { if (kind === "m") throw new TypeError("Private method is not writable"); if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter"); if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it"); return kind === "a" ? f.call(receiver, value) : f ? (f.value = value) : state.set(receiver, value), value; };
var __classPrivateFieldIn = function (state, receiver) { if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object"); return typeof state === "function" ? receiver === state : state.has(receiver); };`;

const show = `const show = value => JSON.stringify(value, (key, each) => (each === undefined ? "undefined" : typeof each === "function" ? "function" : each));`;
const declaredAtTheTop = /\b(make|makes|Maker|out|state|marks|brand|step|holder)\b/g;

export function programOf(index: number): { file: string; text: string; files?: Record<string, string> } {
  let first = index;
  const { kind, cases } = laidOut.find(({ cases }) => first < Math.ceil(cases.length / inOne) || ((first -= Math.ceil(cases.length / inOne)), false))!; // prettier-ignore
  const { file, isInTwoFiles } = kind;
  const exported: string[] = [];
  const blocks = cases.slice(first * inOne, (first + 1) * inOne).map(({ holds, use, written }, at) => {
    // In another file the functions stand side by side at the top, so there each case has names of its own.
    const named = (text: string) => (isInTwoFiles ? text.replace(declaredAtTheTop, `$1${at}`) : text);
    const made = named(`${holds.outside ? `${holds.outside}\n  ` : ""}${written.text(holds.text)}`);
    if (isInTwoFiles) exported.push(...new Set(named(`make ${holds.outside ?? ""}`).match(/\b[a-z]+\d+\b/g)));
    const used = written.isAwaited ? (use.awaited ?? use.text.replace(/make\((\w*)\)/g, "(await make($1))")) : use.text;
    const seen = use.makesTwo
      ? `[C0 === C, sees(C), sees(C0)${holds.across ? `, ((A, B) => ${holds.across})(C0, C)` : ""}]`
      : "sees(C)";
    return {
      made,
      rest: `${named(used)}
  let line;
  try {
    const sees = C => ${named(holds.sees)};
    line = show(${named(seen)});
  } catch (error) {
    line = "THROWS " + error.constructor.name;
  }
  console.log(${JSON.stringify(`${written.name} | ${use.name} | ${holds.name}`)} + ": " + line);`,
    };
  });
  if (isInTwoFiles)
    return {
      file,
      text: `import { ${exported.join(", ")} } from "./made.mjs";\n${show}\n${blocks.map(({ rest }) => `{\n  ${rest}\n}`).join("\n")}\n`,
      files: {
        "made.mjs": `${helpers}\n${blocks.map(({ made }) => made.replaceAll("\n  ", "\n")).join("\n")}\nexport { ${exported.join(", ")} };\n`,
      },
    };
  return {
    file,
    text: `${file.endsWith(".ts") ? "// @ts-nocheck\n" : ""}${helpers}\n${show}\n${blocks.map(({ made, rest }) => `{\n  ${made}\n  ${rest}\n}`).join("\n")}\n${file.endsWith(".ts") ? "export {};\n" : ""}`,
  };
}
