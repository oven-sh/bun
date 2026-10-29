// Programs about one question: the object a base constructor allocates belongs to new.target's class, which need not be the class of the constructor.
// The table is a cross product: how another new.target arises x what the base constructor does with `this` x how often and where the construction runs x what is observed afterwards.
//
// The origins with "laundered" and "outside" use launder, constructIt and constructFor, which whoever runs the program defines outside the compiled program.
// constructFor constructs a function for another new.target, which native code never does: the two origins outside-constructs-for-.. are for a build that admits unknown JavaScript.
//
// The origins marked usesLibraryFunctions, the look "copied" and the forms over a class of the host need built-ins that are written in JavaScript or the host itself.
//
//   bun new-targets.ts <folder> [--print=print|console.log] [--filter=<regex over names>] [--contexts=once,shared,..] [--looks=direct,generic,..]
//
// writes <folder>/<name>.js. The whole product has millions of programs: pass a filter. `pickCombination` draws one of them for another driver.
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

type MemberKind = "method" | "get" | "set";
interface Member {
  kind: MemberKind;
  name: string;
  parameters?: string;
  body: string;
  isStatic?: boolean;
}

interface Action {
  name: string;
  /** Statements in front of everything. */
  before?: string;
  /** Class fields of the base: only a class can have them. */
  baseFields?: string[];
  /** The body of the base constructor; its parameters are `p` and `q`. */
  body: string;
  baseMembers?: Member[];
  /** What the class of the other new.target has. */
  otherMembers?: Member[];
  /** Class fields of the other class: they run only where its constructor runs. */
  otherFields?: string[];
  /** Statements that run once the other class exists. `P` is its prototype object, `T` the class itself. */
  patch?: (P: string, T: string) => string;
  /** Expressions that are printed; `$` is the constructed object. */
  look: string[];
  /** Expressions that are printed after everything, also when the construction threw. */
  lookAfter?: string[];
  /** `new A()` throws. */
  refusesBaseItself?: boolean;
}

const method = (name: string, body: string, parameters = ""): Member => ({ kind: "method", name, parameters, body });
const getter = (name: string, body: string): Member => ({ kind: "get", name, body });
const setter = (name: string, body: string): Member => ({ kind: "set", name, parameters: "x", body });

const manyValues = Array.from({ length: 70 }, (_, index) => (index % 3 === 0 ? `${index}.5` : index % 3 === 1 ? `"s${index}"` : `${index}`));

const actions: Action[] = [
  {
    name: "calls-overridden-method",
    body: `this.r = this.m();`,
    baseMembers: [method("m", `return "A.m";`)],
    otherMembers: [method("m", `return "B.m";`)],
    look: [`$.r`, `$.m()`],
  },
  {
    name: "overridden-method-stores",
    body: `this.first = 1; this.init(); this.last = 2;`,
    baseMembers: [method("init", ``)],
    otherMembers: [method("init", `this.seen = 7;`)],
    otherFields: [`s = 5`],
    look: [`$.first`, `$.seen`, `$.last`, `$.s`],
  },
  {
    name: "overridden-method-reads-later-field",
    body: `this.r = this.m();`,
    baseMembers: [method("m", `return "A.m";`)],
    otherMembers: [method("m", `return "B.m " + this.text;`)],
    otherFields: [`text = "ok"`],
    look: [`$.r`, `$.m()`, `$.text`],
  },
  {
    name: "overridden-method-overwrites-base-field",
    baseFields: [`x = 1`, `y = 2`],
    body: `this.init(); this.z = this.x + this.y;`,
    baseMembers: [method("init", ``)],
    otherMembers: [method("init", `this.x = "one"; this.y = "two";`)],
    look: [`$.x`, `$.y`, `$.z`],
  },
  {
    name: "reads-data-property-of-prototype",
    body: `this.seen = this.z;`,
    patch: P => `${P}.z = "proto";`,
    look: [`$.seen`, `$.z`],
  },
  {
    name: "helper-reads-data-property-of-prototype",
    before: `function read(x) { return x.z; }`,
    body: `this.seen = read(this);`,
    patch: P => `${P}.z = "proto";`,
    look: [`$.seen`, `$.z`],
  },
  {
    name: "reads-getter",
    body: `this.seen = this.g;`,
    otherMembers: [getter("g", `return "B.g";`)],
    look: [`$.seen`, `$.g`],
  },
  {
    name: "reads-overridden-getter",
    body: `this.seen = this.g;`,
    baseMembers: [getter("g", `return "A.g";`)],
    otherMembers: [getter("g", `return "B.g";`)],
    look: [`$.seen`, `$.g`],
  },
  {
    name: "getter-hides-method",
    body: `this.r = this.m();`,
    baseMembers: [method("m", `return "A.m";`)],
    otherMembers: [getter("m", `return () => "from getter";`)],
    look: [`$.r`, `$.m()`],
  },
  {
    name: "data-property-hides-method",
    body: `this.r = this.m();`,
    baseMembers: [method("m", `return "A.m";`)],
    patch: P => `${P}.m = function () { return "patched"; };`,
    look: [`$.r`, `$.m()`],
  },
  {
    name: "store-meets-setter",
    body: `this.v = 21; this.w = 1;`,
    otherMembers: [setter("v", `this.hidden = x * 2;`), getter("v", `return "getter";`)],
    look: [`$.v`, `$.hidden`, `$.w`, `Object.hasOwn($, "v")`],
  },
  {
    name: "store-meets-setter-then-reads",
    body: `this.v = 21; this.seen = this.v;`,
    otherMembers: [setter("v", `this.hidden = x * 2;`), getter("v", `return "getter";`)],
    look: [`$.seen`, `$.hidden`, `Object.hasOwn($, "v")`],
  },
  {
    name: "store-meets-getter-alone",
    body: `this.w = 1; this.v = 21; this.u = 2;`,
    otherMembers: [getter("v", `return "getter";`)],
    look: [`$.v`, `$.w`, `$.u`],
    before: `let leaked;`,
    lookAfter: [],
  },
  {
    name: "store-meets-read-only-property",
    before: `let leaked;`,
    body: `leaked = this; this.w = 1; this.v = 21; this.u = 2;`,
    patch: P => `Object.defineProperty(${P}, "v", { value: 9, writable: false });`,
    look: [`$.v`, `$.w`, `$.u`],
    lookAfter: [`leaked.w`, `leaked.v`, `leaked.u`, `Object.hasOwn(leaked, "v")`],
  },
  {
    name: "field-definition-passes-setter",
    baseFields: [`v = 21`],
    body: `this.w = 1;`,
    otherMembers: [setter("v", `this.hidden = x * 2;`), getter("v", `return "getter";`)],
    look: [`$.v`, `$.hidden`, `$.w`, `Object.hasOwn($, "v")`],
  },
  {
    name: "object-assign-meets-setter",
    body: `Object.assign(this, { v: 21, w: 1 });`,
    otherMembers: [setter("v", `this.hidden = x * 2;`), getter("v", `return "getter";`)],
    look: [`$.v`, `$.hidden`, `$.w`, `Object.hasOwn($, "v")`],
  },
  {
    name: "indexed-store-meets-setter",
    body: `this[0] = "zero"; this.x = 1;`,
    patch: P => `Object.defineProperty(${P}, "0", { set(x) { this.index = x; }, configurable: true });`,
    look: [`$[0]`, `$.index`, `$.x`],
  },
  {
    name: "other-class-declares-same-field",
    body: `this.x = 1; this.y = 2;`,
    otherFields: [`w = 3`, `x = 10`],
    look: [`$.x`, `$.y`, `$.w`],
  },
  {
    name: "both-classes-declare-fields",
    baseFields: [`x = 1`, `y = 2`],
    body: ``,
    otherFields: [`y = 20`, `z`, `x = 10`],
    look: [`$.x`, `$.y`, `$.z`, `Object.hasOwn($, "z")`],
  },
  {
    name: "field-without-initializer-resets",
    body: `this.x = 1; this.y = 2;`,
    otherFields: [`x`],
    look: [`$.x`, `$.y`, `Object.hasOwn($, "x")`],
  },
  {
    name: "field-changes-type",
    body: `this.x = 1; this.sum = this.x + 1;`,
    otherFields: [`x = "text"`],
    baseMembers: [method("twice", `return this.x + this.x;`)],
    look: [`$.x`, `$.sum`, `$.twice()`],
  },
  {
    name: "leaks-to-variable",
    before: `let leaked;`,
    body: `leaked = this; this.x = 1;`,
    otherFields: [`s = 5`],
    otherMembers: [method("m", `return "B.m";`)],
    look: [`leaked === $`, `leaked.x`, `leaked.s`, `typeof leaked.m`],
  },
  {
    name: "leaks-to-callback",
    before: `let got; function sink(x) { got = x; }`,
    body: `sink(this); this.x = 1;`,
    otherFields: [`s = 5`],
    look: [`got === $`, `got.x`, `got.s`],
  },
  {
    name: "leaks-to-map",
    before: `const registry = new Map();`,
    body: `registry.set("k", this); this.x = 1;`,
    otherFields: [`s = 5`],
    look: [`registry.get("k") === $`, `registry.get("k").x`, `registry.get("k").s`],
  },
  {
    name: "leaks-to-weak-map",
    before: `const notes = new WeakMap();`,
    body: `notes.set(this, "note"); this.x = 1;`,
    otherFields: [`s = 5`],
    look: [`notes.get($)`, `notes.has($)`, `$.s`],
  },
  {
    name: "leaks-to-array",
    before: `const all = [];`,
    body: `all.push(this); this.x = 1;`,
    otherFields: [`s = 5`],
    look: [`all[all.length - 1] === $`, `all[all.length - 1].s`, `all.length`],
  },
  {
    name: "leaks-to-closure",
    body: `this.self = () => this; this.x = 1;`,
    otherFields: [`s = 5`],
    look: [`$.self() === $`, `$.self().s`, `$.self().x`],
  },
  {
    name: "closure-calls-overridden-method-later",
    body: `this.later = () => this.m();`,
    baseMembers: [method("m", `return "A.m";`)],
    otherMembers: [method("m", `return "B.m " + this.s;`)],
    otherFields: [`s = 5`],
    look: [`$.later()`],
  },
  {
    name: "private-field",
    baseFields: [`#p = 1`],
    body: `this.r = this.#p + this.m();`,
    baseMembers: [method("m", `return 10;`), method("p", `return this.#p;`), { kind: "method", name: "has", parameters: "x", body: `return #p in x;`, isStatic: true }],
    otherMembers: [method("m", `return 20;`)],
    otherFields: [`s = 5`],
    look: [`$.r`, `$.p()`, `A.has($)`, `$.s`],
  },
  {
    name: "private-method",
    body: `this.r = this.#pm() + this.m();`,
    baseMembers: [method("#pm", `return "A.#pm ";`), method("m", `return "A.m";`), { kind: "method", name: "has", parameters: "x", body: `return #pm in x;`, isStatic: true }],
    otherMembers: [method("m", `return "B.m";`)],
    look: [`$.r`, `A.has($)`],
  },
  {
    name: "private-accessor",
    baseFields: [`#store = 1`],
    body: `this.#v = 4; this.r = this.#v + this.m();`,
    baseMembers: [getter("#v", `return this.#store;`), setter("#v", `this.#store = x * 2;`), method("m", `return 10;`)],
    otherMembers: [method("m", `return 20;`)],
    look: [`$.r`],
  },
  {
    name: "private-field-of-other-class-read-early",
    body: `try { this.r = this.q(); } catch (e) { this.r = e.name; }`,
    baseMembers: [method("q", `return "A.q";`)],
    otherMembers: [method("q", `return this.#q;`)],
    otherFields: [`#q = 2`],
    look: [`$.r`, `$.q()`],
  },
  {
    name: "same-private-name-in-both",
    baseFields: [`#p = "A"`],
    body: `this.r = this.#p;`,
    baseMembers: [method("base", `return this.#p;`)],
    otherFields: [`#p = "B"`],
    otherMembers: [method("other", `return this.#p;`)],
    look: [`$.r`, `$.base()`, `typeof $.other === "function" ? $.other() : "none"`],
  },
  {
    name: "static-private",
    body: `this.r = A.#count(this);`,
    baseMembers: [{ kind: "method", name: "#count", parameters: "x", body: `return x.m();`, isStatic: true }, method("m", `return "A.m";`)],
    otherMembers: [method("m", `return "B.m";`)],
    look: [`$.r`],
  },
  {
    name: "reads-constructor",
    body: `this.n = this.constructor.name; this.same = this.constructor === A;`,
    look: [`$.n`, `$.same`, `$.constructor === A`],
  },
  {
    name: "constructs-its-own-constructor",
    before: `let depth = 0;`,
    body: `this.level = depth; if (depth++ < 1) this.child = new this.constructor(p, q); depth--;`,
    baseMembers: [method("m", `return "A.m";`)],
    otherMembers: [method("m", `return "B.m";`)],
    otherFields: [`s = 5`],
    look: [`$.level`, `$.child.level`, `$.child.m()`, `$.child.s`, `Object.getPrototypeOf($.child) === Object.getPrototypeOf($)`],
  },
  {
    name: "reads-its-prototype",
    body: `this.isA = Object.getPrototypeOf(this) === A.prototype; this.isObject = Object.getPrototypeOf(this) === Object.prototype;`,
    look: [`$.isA`, `$.isObject`],
  },
  {
    name: "tests-instanceof",
    body: `this.a = this instanceof A; this.proto = A.prototype.isPrototypeOf(this);`,
    look: [`$.a`, `$.proto`],
  },
  {
    name: "reads-new-target",
    body: `this.same = new.target === A; this.kind = typeof new.target; this.link = !!new.target && new.target.prototype === Object.getPrototypeOf(this);`,
    look: [`$.same`, `$.kind`, `$.link`],
  },
  {
    name: "reads-static-of-new-target",
    body: `this.d = new.target ? new.target.defaults : "no new.target"; this.c = this.constructor.defaults;`,
    patch: (P, T) => `A.defaults = "A.defaults"; ${T}.defaults = "B.defaults";`,
    look: [`$.d`, `$.c`],
  },
  {
    name: "freezes",
    body: `this.x = 1; Object.freeze(this);`,
    otherFields: [`s = 5`],
    before: `let leaked;`,
    look: [`$.x`, `$.s`, `Object.isFrozen($)`],
  },
  {
    name: "seals",
    before: `let leaked;`,
    body: `leaked = this; this.x = 1; Object.seal(this);`,
    otherFields: [`x = 2`, `s = 5`],
    look: [`$.x`, `$.s`],
    lookAfter: [`leaked.x`, `leaked.s`, `Object.isSealed(leaked)`],
  },
  {
    name: "prevents-extensions",
    before: `let leaked;`,
    body: `leaked = this; this.x = 1; Object.preventExtensions(this);`,
    otherFields: [`x = 2`, `s = 5`],
    look: [`$.x`, `$.s`],
    lookAfter: [`leaked.x`, `leaked.s`, `Object.isExtensible(leaked)`],
  },
  {
    name: "throws-midway",
    before: `let leaked;`,
    body: `leaked = this; this.x = 1; if (this.bad()) throw new RangeError("no"); this.y = 2;`,
    baseMembers: [method("bad", `return false;`)],
    otherMembers: [method("bad", `return true;`)],
    otherFields: [`s = 5`],
    look: [`$.x`, `$.y`, `$.s`],
    lookAfter: [`leaked.x`, `leaked.y`, `leaked.s`, `leaked.bad()`],
  },
  {
    name: "enumerates-with-for-in",
    body: `this.x = 1; let names = ""; for (const k in this) names += k + ","; this.names = names;`,
    patch: P => `${P}.z = "proto";`,
    look: [`$.names`],
  },
  {
    name: "tests-in",
    body: `this.has = "z" in this; this.hasM = "m" in this;`,
    otherMembers: [method("m", `return 1;`)],
    patch: P => `${P}.z = "proto";`,
    look: [`$.has`, `$.hasM`],
  },
  {
    name: "converts-to-primitive",
    body: `this.text = "" + this; this.number = +this;`,
    otherMembers: [method("valueOf", `return 42;`), method("toString", `return "B!";`)],
    look: [`$.text`, `$.number`, `\`\${$}\``],
  },
  {
    name: "converts-with-symbol",
    body: `this.text = "" + this;`,
    otherMembers: [method("[Symbol.toPrimitive]", `return "hint " + hint;`, "hint")],
    look: [`$.text`, `$ + 1`],
  },
  {
    name: "serializes",
    body: `this.x = 1; this.json = JSON.stringify(this);`,
    otherMembers: [method("toJSON", `return "B.json";`)],
    look: [`$.json`, `JSON.stringify($)`],
  },
  {
    name: "reads-by-computed-key",
    before: `let key = "m"; function other() { key = "n"; }`,
    body: `this.r = this[key]();`,
    baseMembers: [method("m", `return "A.m";`), method("n", `return "A.n";`)],
    otherMembers: [method("m", `return "B.m";`)],
    look: [`$.r`, `$[key]()`],
  },
  {
    name: "deletes-then-reads",
    body: `this.x = 1; delete this.x; this.seen = this.x;`,
    patch: P => `${P}.x = "proto x";`,
    look: [`$.seen`, `$.x`, `Object.hasOwn($, "x")`],
  },
  {
    name: "overriding-method-calls-super",
    body: `this.r = this.m();`,
    baseMembers: [method("m", `return "A.m";`)],
    otherMembers: [method("m", `return "B+" + super.m();`)],
    look: [`$.r`, `$.m()`],
  },
  {
    name: "field-initializer-calls-overridden-method",
    baseFields: [`r = this.m()`],
    body: ``,
    baseMembers: [method("m", `return "A.m";`)],
    otherMembers: [method("m", `return "B.m";`)],
    look: [`$.r`],
  },
  {
    name: "field-initializer-reads-prototype",
    baseFields: [`seen = this.z`, `kind = this.constructor.name`],
    body: ``,
    patch: P => `${P}.z = "proto";`,
    look: [`$.seen`, `$.kind`],
  },
  {
    name: "arrow-in-field-calls-overridden-method",
    baseFields: [`f = () => this.m()`],
    body: ``,
    baseMembers: [method("m", `return "A.m";`)],
    otherMembers: [method("m", `return "B.m";`)],
    look: [`$.f()`],
  },
  {
    name: "helper-stores-and-calls",
    before: `function setUp(x) { x.a = 1; x.r = x.m(); x.b = 2; }`,
    body: `setUp(this);`,
    baseMembers: [method("m", `return "A.m";`)],
    otherMembers: [method("m", `this.mid = "mid"; return "B.m";`)],
    look: [`$.a`, `$.r`, `$.mid`, `$.b`],
  },
  {
    name: "returns-another-object",
    before: `const another = { tag: "another" };`,
    body: `this.x = 1; return another;`,
    otherFields: [`s = 5`],
    otherMembers: [method("m", `return "B.m";`)],
    look: [`$ === another`, `$.x`, `$.s`, `$.tag`, `typeof $.m`],
    lookAfter: [`another.s`],
  },
  {
    name: "returns-fresh-literal",
    body: `this.x = 1; return { x: 2, made: "literal" };`,
    otherFields: [`s = 5`],
    otherMembers: [method("m", `return "B.m";`)],
    look: [`$.x`, `$.s`, `$.made`, `typeof $.m`],
  },
  {
    name: "returns-primitive",
    body: `this.x = 1; return 5;`,
    otherFields: [`s = 5`],
    look: [`typeof $`, `$.x`, `$.s`],
  },
  {
    name: "returns-instance-of-other-layout",
    before: `class Elsewhere { constructor() { this.e = "elsewhere"; } m() { return "Elsewhere.m"; } }`,
    body: `this.x = 1; if (new.target !== A) return new Elsewhere();`,
    baseMembers: [method("m", `return "A.m";`)],
    otherFields: [`s = 5`],
    look: [`$.x`, `$.e`, `$.s`, `$.m()`],
  },
  {
    name: "prototype-without-base-methods",
    body: `this.kind = typeof this.m; this.r = this.m ? this.m() : "none";`,
    baseMembers: [method("m", `return "A.m";`)],
    patch: P => `Object.setPrototypeOf(${P}, null);`,
    look: [`$.kind`, `$.r`],
  },
  {
    name: "defines-property",
    body: `Object.defineProperty(this, "v", { value: 1, enumerable: true, writable: true, configurable: true }); this.seen = this.v;`,
    otherMembers: [getter("v", `return "getter";`), setter("v", `this.hidden = x;`)],
    look: [`$.v`, `$.seen`, `$.hidden`],
  },
  {
    name: "uses-arguments",
    body: `this.p = p; this.q = q; this.r = this.join(p, q);`,
    baseMembers: [method("join", `return a + "/" + b;`, "a, b")],
    otherMembers: [method("join", `return b + "\\\\" + a;`, "a, b")],
    look: [`$.p`, `$.q`, `$.r`],
  },
  {
    name: "number-field-becomes-other-number-kind",
    body: `this.n = 1; this.scale(); this.total = this.n + 1;`,
    baseMembers: [method("scale", `this.n = this.n * 2;`)],
    otherMembers: [method("scale", `this.n = this.n / 4;`)],
    look: [`$.n`, `$.total`],
  },
  {
    name: "method-deletes-base-field",
    body: `this.x = 1; this.y = 2; this.trim(); this.seen = this.x;`,
    baseMembers: [method("trim", ``)],
    otherMembers: [method("trim", `delete this.x;`)],
    look: [`$.x`, `$.y`, `$.seen`, `Object.hasOwn($, "x")`],
  },
  {
    name: "method-changes-prototype-of-this",
    before: `const elsewhere = { m() { return "elsewhere.m"; }, move() {} };`,
    body: `this.move(); this.r = this.m();`,
    baseMembers: [method("move", ``), method("m", `return "A.m";`)],
    otherMembers: [method("move", `Object.setPrototypeOf(this, elsewhere);`)],
    look: [`$.r`, `$.m()`],
  },
  {
    name: "optional-hook",
    body: `this.r = this.hook?.(p); this.t = typeof this.hook;`,
    otherMembers: [method("hook", `return "B.hook " + x;`, "x")],
    look: [`$.r`, `$.t`],
  },
  {
    name: "abstract-class-check",
    refusesBaseItself: true,
    body: `if (new.target === A) throw new TypeError("abstract"); this.r = "made";`,
    otherMembers: [method("m", `return "B.m";`)],
    look: [`$.r`],
  },
  {
    name: "overridden-method-sees-defined-field-before-the-store",
    baseFields: [`x = 0`],
    body: `this.seen = this.peek(); this.x = "text";`,
    baseMembers: [method("peek", `return "A.peek";`)],
    otherMembers: [method("peek", `return this.x;`)],
    look: [`$.seen`, `$.x`],
  },
  {
    name: "leaked-object-read-between-definition-and-store",
    before: `const registry = [];\nlet noted = "nothing";\nfunction note() { noted = registry[registry.length - 1].x; }`,
    baseFields: [`w = registry.push(this)`, `x = 0`],
    body: `note(); this.x = "text";`,
    look: [`$.x`, `$.w > 0`],
    lookAfter: [`noted`],
  },
  {
    name: "other-class-field-read-through-a-leak",
    before: `const registry = [];\nfunction latest() { return registry[registry.length - 1]; }`,
    body: `registry.push(this); this.x = 1;`,
    otherFields: [`y = 0`, `z = latest().y`, `y2 = (this.y = "text")`],
    look: [`$.x`, `$.y`, `$.z`, `$.y2`],
  },
  {
    name: "arrow-in-field-keeps-identity",
    baseFields: [`f = () => this`],
    body: `this.same = this.f === this.f;`,
    otherMembers: [method("m", `return this.f() === this;`)],
    look: [`$.same`, `$.f === $.f`, `$.f() === $`, `$.f.name`, `typeof $.m === "function" ? $.m() : "none"`],
  },
  {
    name: "arrow-in-field-hidden-by-field-of-other-class",
    baseFields: [`f = () => "A.f"`],
    body: `this.r = this.f();`,
    otherFields: [`f = 7`],
    look: [`$.r`, `typeof $.f`, `typeof $.f === "function" ? $.f() : $.f`],
  },
  {
    name: "arrow-in-field-over-accessor-of-other-class",
    before: `let stored = "nothing";`,
    baseFields: [`f = () => "A.f"`],
    body: `this.r = this.f();`,
    otherMembers: [getter("f", `return () => "B.f";`), setter("f", `stored = "setter ran";`)],
    look: [`$.r`, `$.f()`, `Object.hasOwn($, "f")`],
    lookAfter: [`stored`],
  },
  {
    name: "arrow-in-field-gets-a-property",
    baseFields: [`f = () => 1`],
    body: `this.f.tag = p;`,
    otherMembers: [method("m", `return this.f.tag;`)],
    look: [`$.f.tag`, `typeof $.m === "function" ? $.m() : "none"`],
  },
  {
    name: "order-of-stores-follows-overridden-method",
    body: `if (this.swapped()) { this.b = 2; this.a = 1; } else { this.a = 1; this.b = 2; }`,
    baseMembers: [method("swapped", `return false;`)],
    otherMembers: [method("swapped", `return true;`)],
    look: [`Object.keys($).join()`, `JSON.stringify($)`],
  },
  {
    name: "overridden-method-stores-first",
    body: `this.prepare(); this.a = 1; this.b = 2;`,
    baseMembers: [method("prepare", ``)],
    otherMembers: [method("prepare", `this.b = "early";`)],
    look: [`Object.keys($).join()`, `$.a`, `$.b`],
  },
  {
    name: "overridden-method-defines-own-accessor",
    before: `let stored = "nothing";`,
    body: `this.prepare(); this.x = 1; this.seen = this.x;`,
    baseMembers: [method("prepare", ``)],
    otherMembers: [method("prepare", `Object.defineProperty(this, "x", { get() { return "own getter"; }, set(v) { stored = v; }, configurable: true, enumerable: true });`)],
    look: [`$.x`, `$.seen`, `Object.keys($).join()`],
    lookAfter: [`stored`],
  },
  {
    name: "overridden-method-defines-read-only-property",
    body: `this.prepare(); this.x = 1; this.seen = this.x;`,
    baseMembers: [method("prepare", ``)],
    otherMembers: [method("prepare", `Object.defineProperty(this, "x", { value: "fixed", writable: false, configurable: true, enumerable: false });`)],
    look: [`$.x`, `$.seen`, `Object.keys($).join()`],
  },
  {
    name: "overridden-method-freezes",
    body: `this.a = 1; this.lock(); this.a = 2; this.b = 3;`,
    baseMembers: [method("lock", ``)],
    otherMembers: [method("lock", `Object.freeze(this);`)],
    look: [`$.a`, `$.b`, `Object.isFrozen($)`],
  },
  {
    name: "overridden-method-prevents-extensions",
    body: `this.a = 1; this.lock(); this.a = 2; this.b = 3;`,
    baseMembers: [method("lock", ``)],
    otherMembers: [method("lock", `Object.preventExtensions(this);`)],
    otherFields: [`late = 1`],
    look: [`$.a`, `$.b`, `Object.isExtensible($)`],
  },
  {
    name: "increments-inherited-number",
    body: `this.tally++; this.total += 0.5;`,
    baseMembers: [],
    patch: P => `${P}.tally = 10; ${P}.total = "text";`,
    look: [`$.tally`, `$.total`, `Object.hasOwn($, "tally")`],
  },
  {
    name: "assigns-if-missing",
    body: `this.x ??= "A default"; this.y ||= "A default";`,
    patch: P => `${P}.x = "from prototype"; ${P}.y = 0;`,
    look: [`$.x`, `$.y`, `Object.hasOwn($, "x")`, `Object.hasOwn($, "y")`],
  },
  {
    name: "symbol-keyed-members",
    before: `const key = Symbol("key");`,
    body: `this.r = this[key](); this[key] = "own";`,
    baseMembers: [method("[key]", `return "A[key]";`)],
    otherMembers: [method("[key]", `return "B[key]";`)],
    look: [`$.r`, `$[key]`, `Object.getOwnPropertySymbols($).length`],
  },
  {
    name: "destructures-this",
    body: `const { m, d = "default", ...rest } = this; this.r = typeof m; this.d = d; this.rest = Object.keys(rest).length;`,
    baseMembers: [method("m", `return "A.m";`)],
    patch: P => `${P}.d = "from prototype";`,
    look: [`$.r`, `$.d`, `$.rest`],
  },
  {
    name: "passes-this-to-static-of-new-target",
    body: `this.x = 1; this.r = new.target.register ? new.target.register(this) : "no register";`,
    otherMembers: [{ kind: "method", name: "register", parameters: "o", body: `o.registered = true; return o.x + 1;`, isStatic: true }],
    look: [`$.r`, `$.registered`, `Object.keys($).join()`],
  },
  {
    name: "calls-method-with-this-of-other-kind",
    body: `this.x = 1; this.r = this.m.call({ x: "literal" }) + "," + this.m.call(this);`,
    baseMembers: [method("m", `return "A.m " + this.x;`)],
    otherMembers: [method("m", `return "B.m " + this.x;`)],
    look: [`$.r`],
  },
  {
    name: "stores-under-name-of-method-of-other-class",
    body: `this.run = "data"; this.t = typeof this.run;`,
    otherMembers: [method("run", `return "B.run";`)],
    look: [`$.run`, `$.t`],
  },
  {
    name: "field-named-like-method-of-other-class",
    baseFields: [`run = "data"`],
    body: `this.t = typeof this.run;`,
    otherMembers: [method("run", `return "B.run";`), method("viaSuper", `return typeof super.run;`)],
    look: [`$.run`, `$.t`],
  },
  {
    name: "compares-prototype-chain-length",
    body: `let n = 0; for (let o = Object.getPrototypeOf(this); o; o = Object.getPrototypeOf(o)) n++; this.depth = n;`,
    look: [`$.depth > 0`, `A.prototype.isPrototypeOf($)`, `B.prototype ? Object.prototype.isPrototypeOf.call(B.prototype, $) : "none"`],
  },
  {
    name: "getter-of-other-class-reads-unfinished-object",
    body: `this.early = this.sum; this.a = 1; this.b = 2; this.late = this.sum;`,
    baseMembers: [getter("sum", `return "A.sum";`)],
    otherMembers: [getter("sum", `return this.a + this.b;`)],
    look: [`$.early`, `$.late`],
  },
  {
    name: "second-construction-inside-the-first",
    before: `let depth = 0;`,
    body: `this.level = depth; if (depth++ < 1) this.inner = new new.target(p, q); depth--; this.name = this.m();`,
    baseMembers: [method("m", `return "A.m";`)],
    otherMembers: [method("m", `return "B.m";`)],
    otherFields: [`own = "own"`],
    look: [`$.level`, `$.name`, `$.inner.level`, `$.inner.name`, `$.inner.own`, `Object.getPrototypeOf($.inner) === Object.getPrototypeOf($)`],
  },
  {
    name: "returns-proxy-of-this",
    before: `let raw;`,
    body: `this.x = 1; raw = this; return new Proxy(this, {});`,
    otherFields: [`s = 5`],
    otherMembers: [method("m", `return "B.m " + this.s;`)],
    look: [`$.x`, `$.s`, `raw.s`, `raw === $`, `Object.keys(raw).join()`, `typeof $.m === "function" ? $.m() : "none"`],
  },
  {
    name: "returns-proxy-with-traps",
    before: `let raw;\nconst log = [];`,
    body: `this.x = 1; raw = this; return new Proxy(this, { defineProperty(target, key, descriptor) { log.push("define " + String(key) + " " + descriptor.value); return Reflect.defineProperty(target, key, descriptor); }, set(target, key, value, receiver) { log.push("set " + String(key)); return Reflect.set(target, key, value, receiver); } });`,
    otherFields: [`s = 5`, `t = (this.s = "again")`],
    look: [`$.x`, `$.s`, `$.t`, `raw.s`, `raw.t`],
    lookAfter: [`log.join()`],
  },
  {
    name: "returns-frozen-object",
    before: `const frozen = Object.freeze({ tag: "frozen" });`,
    body: `this.x = 1; return frozen;`,
    otherFields: [`s = 5`],
    look: [`$.tag`, `$.s`],
    lookAfter: [`frozen.s`, `Object.keys(frozen).join()`],
  },
  {
    name: "returns-array",
    body: `this.x = 1; return [p, q];`,
    otherFields: [`s = 5`, `length = 1`],
    look: [`Array.isArray($)`, `$.length`, `$[0]`, `$[1]`, `$.s`],
  },
  {
    name: "returns-function",
    body: `this.x = 1; return function made() { return "called"; };`,
    otherFields: [`s = 5`],
    look: [`typeof $`, `$()`, `$.s`, `$.name`],
  },
  {
    name: "returns-the-first-instance",
    before: `let first;`,
    body: `if (first) return first; first = this; this.n = 0;`,
    otherFields: [`s = (this.n = this.n + 1)`],
    look: [`$ === first`, `$.n`, `$.s`],
    lookAfter: [`first && first.n`],
  },
  {
    name: "private-field-on-returned-object",
    before: `const shared = { tag: "shared" };`,
    body: `return shared;`,
    otherFields: [`#secret = 5`],
    otherMembers: [{ kind: "method", name: "read", parameters: "o", body: `return #secret in o ? o.#secret : "no brand";`, isStatic: true }],
    look: [`$ === shared`, `typeof B.read === "function" ? B.read($) : "none"`],
    lookAfter: [`typeof B.read === "function" ? B.read(shared) : "none"`, `typeof B.read === "function" ? B.read({}) : "none"`],
  },
  {
    name: "returns-object-created-from-new-target",
    body: `const made = Object.create(new.target.prototype); made.x = 1; made.r = made.m ? made.m() : "none"; return made;`,
    baseMembers: [method("m", `return "A.m";`)],
    otherMembers: [method("m", `return "B.m";`)],
    otherFields: [`s = 5`],
    look: [`$.x`, `$.r`, `$.s`, `Object.keys($).join()`],
  },
  {
    name: "constructed-before-the-definition-is-complete",
    before: `var early;\nfunction makeEarly() { return new A(0, "zero"); }\ntry { early = makeEarly(); } catch {}`,
    body: `this.r = this.m ? this.m() : "no m";`,
    baseMembers: [method("m", `return "A.m";`)],
    otherMembers: [method("m", `return "B.m";`)],
    look: [`$.r`],
    lookAfter: [`early && early.r`, `early && typeof early.m`, `early instanceof A`, `early && Object.getPrototypeOf(early) === A.prototype`],
  },
  {
    name: "heir-created-before-the-definition-is-complete",
    before: `var early;\ntry { early = Object.create(A.prototype); } catch {}`,
    body: `this.r = this.m ? this.m() : "no m";`,
    baseMembers: [method("m", `return "A.m";`)],
    look: [`$.r`],
    lookAfter: [`early && typeof early.m`, `early instanceof A`],
  },
  {
    name: "overridden-method-stores-declared-field-early",
    body: `this.a = 1; this.init(); this.b = 2;`,
    baseMembers: [method("init", ``)],
    otherFields: [`y = "field"`],
    otherMembers: [method("init", `this.y = "early"; this.sawY = this.y;`)],
    look: [`Object.keys($).join()`, `$.y`, `$.sawY`],
  },
  {
    name: "field-initializer-of-other-class-throws",
    before: `let leaked;\nfunction boom() { throw new RangeError("boom"); }`,
    body: `leaked = this; this.x = 1;`,
    otherFields: [`s = 1`, `t = boom()`, `u = 3`],
    look: [`$.x`, `$.s`, `$.u`],
    lookAfter: [`leaked.x`, `leaked.s`, `leaked.t`, `leaked.u`, `"u" in leaked`, `Object.keys(leaked).join()`],
  },
  {
    name: "overridden-method-leaks-unfinished-object",
    before: `let leaked;\nfunction peek() { return leaked ? leaked.x : "nothing"; }`,
    body: `this.hook(); this.seen = peek(); this.x = 1;`,
    baseMembers: [method("hook", ``)],
    otherMembers: [method("hook", `leaked = this;`)],
    look: [`$.seen`, `$.x`],
    lookAfter: [`peek()`],
  },
  {
    name: "own-has-instance",
    baseFields: [],
    body: `this.tag = p; this.r = this instanceof A;`,
    baseMembers: [{ kind: "method", name: "[Symbol.hasInstance]", parameters: "x", body: `return x.tag === 2;`, isStatic: true }],
    otherMembers: [{ kind: "method", name: "[Symbol.hasInstance]", parameters: "x", body: `return x.tag === 1;`, isStatic: true }],
    look: [`$.r`, `typeof B === "function" && $ instanceof B`],
  },
  {
    name: "increments-static-through-new-target",
    body: `this.constructor.count++; new.target.total = (new.target.total ?? 0) + 1; this.n = this.constructor.count;`,
    baseMembers: [],
    before: `function statics(C) { return typeof C === "function" ? C.count + "," + C.total + "," + Object.hasOwn(C, "count") + "," + Object.hasOwn(C, "total") : "none"; }`,
    patch: () => `A.count = 0;`,
    look: [`$.n`, `statics(A)`, `statics(B)`],
    lookAfter: [`statics(A)`, `statics(B)`],
  },
  {
    name: "static-field-of-base-written-through-subclass",
    baseFields: [`static count = 0`, `static names = []`],
    body: `new.target.count += 1; new.target.names.push(new.target.name); this.n = new.target.count;`,
    look: [`$.n`, `A.count`, `A.names.join()`, `typeof B === "function" ? B.count + "," + Object.hasOwn(B, "count") + "," + Object.hasOwn(B, "names") : "none"`],
  },
  {
    name: "returns-promise-of-this",
    body: `this.x = 1; return Promise.resolve(this);`,
    otherFields: [`s = 5`],
    look: [`$ instanceof Promise`, `$.s`, `$.x`, `Object.keys($).join()`],
  },
  {
    name: "more-fields-than-fit-in-line",
    body: manyValues.map((value, index) => `this.f${index} = ${value};`).join(" ") + ` this.r = this.total();`,
    baseMembers: [method("total", `return this.f0 + this.f35 + this.f69;`)],
    otherFields: manyValues.map((value, index) => `g${index} = ${value}`),
    otherMembers: [method("total", `return this.f1 + "|" + this.f36 + "|" + this.f68 + "|" + this.g0;`)],
    look: [`$.r`, `Object.keys($).length`, `$.f0 + "," + $.f34 + "," + $.f69`, `$.g0 + "," + $.g34 + "," + $.g69`, `JSON.stringify($).length`],
  },
  {
    name: "store-nobody-reads-meets-setter",
    before: `const log = [];`,
    body: `this.tag = p;`,
    otherMembers: [setter("tag", `log.push("setter " + x);`)],
    look: [`log.join()`],
  },
  {
    name: "field-nobody-reads-hides-setter-for-an-heir",
    before: `const log = [];`,
    body: `this.tag = p;`,
    baseMembers: [],
    // The setter stands on an object of the program's own: Object.prototype cannot be written in a compiled executable.
    patch: P =>
      `if ((Object.getPrototypeOf(${P}) ?? Object.prototype) === Object.prototype) Object.setPrototypeOf(${P}, Object.create(Object.getPrototypeOf(${P})));\n` +
      `Object.defineProperty(Object.getPrototypeOf(${P}), "tag", { set(x) { log.push("setter " + x); }, configurable: true });\nObject.defineProperty(${P}, "tag", { value: 0, writable: true, configurable: true });`,
    look: [`log.join()`, `(() => { const heir = Object.create($); heir.tag = 2; return Object.keys(heir).join() + "|" + log.join(); })()`],
  },
  {
    name: "store-nobody-reads-meets-getter-alone",
    before: `const log = [];`,
    body: `log.push("before"); this.tag = p; log.push("after");`,
    otherMembers: [getter("tag", `return "getter";`)],
    look: [`log.join()`],
    lookAfter: [`log.join()`],
  },
  {
    name: "store-nobody-reads-meets-read-only-property",
    before: `const log = [];`,
    body: `log.push("before"); this.tag = p; log.push("after");`,
    patch: P => `Object.defineProperty(${P}, "tag", { value: 0, writable: false, configurable: true });`,
    look: [`log.join()`],
    lookAfter: [`log.join()`],
  },
  {
    name: "store-nobody-reads-meets-proxy-above",
    before: `const log = [];`,
    body: `this.tag = p;`,
    patch: P => `Object.setPrototypeOf(${P}, new Proxy(Object.getPrototypeOf(${P}) ?? {}, { set(target, key, value, receiver) { log.push("trap " + String(key)); return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true }); } }));`,
    look: [`log.join()`],
  },
  {
    name: "field-definition-nobody-reads-passes-setter",
    before: `const log = [];`,
    baseFields: [`tag = 1`],
    body: `log.push("made");`,
    otherMembers: [setter("tag", `log.push("setter " + x);`)],
    look: [`log.join()`],
  },
  {
    name: "two-stores-nobody-reads-meet-setter",
    before: `const log = [];`,
    body: `this.tag = p; this.other = q; this.tag = q;`,
    otherMembers: [setter("tag", `log.push("setter " + x);`)],
    look: [`log.join()`],
  },
  {
    name: "store-nobody-reads-after-overridden-method-freezes",
    before: `const log = [];`,
    body: `log.push("before"); this.lock(); this.tag = p; log.push("after");`,
    baseMembers: [method("lock", ``)],
    otherMembers: [method("lock", `Object.freeze(this);`)],
    look: [`log.join()`],
    lookAfter: [`log.join()`],
  },
  {
    name: "store-nobody-reads-after-overridden-method-defines-setter",
    before: `const log = [];`,
    body: `this.prepare(); this.tag = p;`,
    baseMembers: [method("prepare", ``)],
    otherMembers: [method("prepare", `Object.defineProperty(this, "tag", { set(x) { log.push("own setter " + x); }, configurable: true });`)],
    look: [`log.join()`],
  },
  {
    name: "store-nobody-reads-after-overridden-method-defines-read-only-property",
    before: `const log = [];`,
    body: `log.push("before"); this.prepare(); this.tag = p; log.push("after");`,
    baseMembers: [method("prepare", ``)],
    otherMembers: [method("prepare", `Object.defineProperty(this, "tag", { value: 0, writable: false, configurable: true });`)],
    look: [`log.join()`],
    lookAfter: [`log.join()`],
  },
];

const usesPrivateNames = (members: Member[] | undefined, fields: string[] | undefined) => !!members?.some(member => member.name.startsWith("#") || member.body.includes("#")) || !!fields?.some(field => field.includes("#"));
const usesSuper = (members: Member[] | undefined) => !!members?.some(member => member.body.includes("super."));

function inClass(members: Member[] = []): string {
  return members.map(({ kind, name, parameters = "", body, isStatic }) => `  ${isStatic ? "static " : ""}${kind === "method" ? "" : kind + " "}${name}(${parameters}) { ${body} }\n`).join("");
}

function inLiteral(members: Member[] = []): string {
  return members.map(({ kind, name, parameters = "", body }) => `  ${kind === "method" ? "" : kind + " "}${name}(${parameters}) { ${body} },\n`).join("");
}

function onPrototype(holder: string, members: Member[] = []): string {
  return members
    .map(({ kind, name, parameters = "", body, isStatic }) => {
      const target = isStatic ? holder : `${holder}.prototype`;
      const key = name.startsWith("[") ? name.slice(1, -1) : JSON.stringify(name);
      if (kind === "method") return `${target}[${key}] = function (${parameters}) { ${body} };\n`.replace(/\["([A-Za-z]+)"\]/, ".$1");
      return `Object.defineProperty(${target}, ${key}, { ${kind}: function (${parameters}) { ${body} }, configurable: true });\n`;
    })
    .join("");
}

interface Parent {
  /** The expression behind `extends`. */
  name: string;
  /** Statements in front of the class. */
  before?: string;
  /** The arguments of the super call. */
  arguments?: string;
  /** A class of the host or of one of its modules. */
  isOfHost?: boolean;
}
const parentsOfBase = {
  "class-over-class": { name: "Root", before: "class Root {}\n" },
  "class-over-object": { name: "Object" },
  "class-over-array": { name: "Array" },
  "class-over-error": { name: "Error" },
  "class-over-map": { name: "Map" },
  "class-over-event-emitter": { name: "EventEmitter", before: `const { EventEmitter } = require("node:events");\n`, isOfHost: true },
  "class-over-readable": { name: "Readable", before: `const { Readable } = require("node:stream");\n`, isOfHost: true },
  "class-over-event-target": { name: "EventTarget", isOfHost: true },
  "class-over-url": { name: "URL", arguments: `"http://example.com/path"`, isOfHost: true },
  "class-over-headers": { name: "Headers", isOfHost: true },
  "class-over-response": { name: "Response", arguments: `"body"`, isOfHost: true },
  "class-over-blob": { name: "Blob", arguments: `["text"]`, isOfHost: true },
} as const satisfies Record<string, Parent>;
type FunctionForm = "function" | "function-with-literal-prototype" | "function-with-prototype-assigned-late" | "function-with-created-prototype";
type BaseForm = "class" | FunctionForm | keyof typeof parentsOfBase;
const functionForms: FunctionForm[] = ["function", "function-with-literal-prototype", "function-with-prototype-assigned-late", "function-with-created-prototype"];
const allForms: BaseForm[] = ["class", ...functionForms, ...(Object.keys(parentsOfBase) as (keyof typeof parentsOfBase)[])];
const isFunctionForm = (form: BaseForm) => (functionForms as BaseForm[]).includes(form);
const isOverHostClass = (form: BaseForm) => form in parentsOfBase && !!(parentsOfBase[form as keyof typeof parentsOfBase] as Parent).isOfHost;

function baseText(action: Action, form: BaseForm): string {
  const fields = (action.baseFields ?? []).map(field => `  ${field};\n`).join("");
  if (form === "class") return `class A {\n${fields}  constructor(p, q) { ${action.body} }\n${inClass(action.baseMembers)}}\n`;
  if (form in parentsOfBase) {
    const parent: Parent = parentsOfBase[form as keyof typeof parentsOfBase];
    return `${parent.before ?? ""}class A extends ${parent.name} {\n${fields}  constructor(p, q) { super(${parent.arguments ?? ""}); ${action.body} }\n${inClass(action.baseMembers)}}\n`;
  }
  if (form === "function-with-created-prototype")
    return `function Root() {}\nRoot.prototype.root = function () { return "Root.root"; };\nfunction A(p, q) { ${action.body} }\nA.prototype = Object.create(Root.prototype, { constructor: { value: A, writable: true, configurable: true } });\n${onPrototype("A", action.baseMembers)}`;
  if (form === "function-with-literal-prototype" || form === "function-with-prototype-assigned-late") {
    const members = action.baseMembers ?? [];
    return `function A(p, q) { ${action.body} }\n${form === "function-with-prototype-assigned-late" ? `try { new A(0, "zero"); } catch {}\n` : ""}A.prototype = {\n  constructor: A,\n${inLiteral(members.filter(member => !member.isStatic))}};\n${onPrototype("A", members.filter(member => member.isStatic))}`;
  }
  return `function A(p, q) { ${action.body} }\n${onPrototype("A", action.baseMembers)}`;
}

interface Origin {
  name: string;
  /** The text that defines `B`, the expression that constructs, and the expression of the prototype object new.target gives. */
  define(action: Action): { text: string; make: string; prototype?: string; target?: string };
  /** The members of the other class are written in an object literal. */
  usesLiteral?: boolean;
  /** Only a base that is a function can be called without `new`. */
  needsFunctionBase?: boolean;
  /** The constructor of the other class does not run, so its fields are never defined. */
  skipsOtherConstructor?: boolean;
  /** Uses launder, constructIt or constructFor, which somebody has to define outside the compiled program. */
  needsOutsideHelpers?: boolean;
  /** Calls built-ins that are written in JavaScript, or a module of the host. */
  usesLibraryFunctions?: boolean;
  /** The text that defines `B` constructs the base itself, outside any handler. */
  constructsBaseItself?: boolean;
  /** The other class is written without class syntax: no private names, no `super`. */
  isTranspiled?: boolean;
}

const classBody = (action: Action, constructor = "") => `${(action.otherFields ?? []).map(field => `  ${field};\n`).join("")}${constructor}${inClass(action.otherMembers)}`;

// What a class becomes when a transpiler writes it for an engine without classes. The helpers are written as such tools write them.
const callSuperHelpers = `function _getPrototypeOf(o) { return Object.getPrototypeOf(o); }
function _isNativeReflectConstruct() { try { var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); } catch (t) {} return (_isNativeReflectConstruct = function () { return !!t; })(); }
function _assertThisInitialized(e) { if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); return e; }
function _possibleConstructorReturn(t, e) { if (e && ("object" == typeof e || "function" == typeof e)) return e; if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined"); return _assertThisInitialized(t); }
function _callSuper(t, o, e) { return (o = _getPrototypeOf(o)), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e)); }
function _inherits(t, e) { (t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } })), Object.defineProperty(t, "prototype", { writable: !1 }), e && Object.setPrototypeOf(t, e); }
function _defineProperty(e, r, t) { return r in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : (e[r] = t), e; }
`;
const extendsHelper = `var __extends = (function () {
  var extendStatics = function (d, b) { return Object.setPrototypeOf(d, b); };
  return function (d, b) { extendStatics(d, b); function __() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __()); };
})();
`;

function definedOnPrototype(holder: string, members: Member[] = []): string {
  return members
    .map(({ kind, name, parameters = "", body, isStatic }) => {
      const key = name.startsWith("[") ? name.slice(1, -1) : JSON.stringify(name);
      const descriptor = kind === "method" ? `value: function (${parameters}) { ${body} }, writable: true` : `${kind}: function (${parameters}) { ${body} }`;
      return `  Object.defineProperty(${isStatic ? holder : `${holder}.prototype`}, ${key}, { ${descriptor}, enumerable: false, configurable: true });\n`;
    })
    .join("");
}

const fieldsDefinedOn = (object: string, fields: string[] = []) =>
  fields
    .map(field => {
      const [name, ...rest] = field.split(" = ");
      return `    _defineProperty(${object}, ${JSON.stringify(name)}, ${rest.length ? rest.join(" = ").replace(/\bthis\b/g, object) : "void 0"});\n`;
    })
    .join("");

const origins: Origin[] = [
  { name: "same", define: () => ({ text: `const B = A;\n`, make: `new A(1, "two")`, prototype: undefined }), skipsOtherConstructor: true },
  { name: "extends", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `new B(1, "two")` }) },
  { name: "extends-explicit", define: action => ({ text: `class B extends A {\n${classBody(action, `  constructor(p, q) { super(p, q); }\n`)}}\n`, make: `new B(1, "two")` }) },
  { name: "extends-spread", define: action => ({ text: `class B extends A {\n${classBody(action, `  constructor(...list) { super(...list); }\n`)}}\n`, make: `new B(1, "two")` }) },
  { name: "extends-stores-after-super", define: action => ({ text: `class B extends A {\n${classBody(action, `  constructor(p, q) { super(p, q); this.own = "own"; }\n`)}}\n`, make: `new B(1, "two")` }) },
  { name: "factory", define: action => ({ text: `const mix = Base => class extends Base {\n${classBody(action)}};\nconst B = mix(A);\n`, make: `new B(1, "two")` }) },
  {
    name: "factory-twice",
    define: action => ({ text: `const mix = Base => class extends Base {\n${classBody(action)}};\nconst First = mix(A);\nconst B = mix(A);\ntry { new First(0, "zero"); } catch {}\n`, make: `new B(1, "two")` }),
  },
  {
    name: "factory-over-factory",
    define: action => ({ text: `const plain = Base => class extends Base { extra() { return "extra"; } };\nconst mix = Base => class extends Base {\n${classBody(action)}};\nconst B = plain(mix(A));\n`, make: `new B(1, "two")`, prototype: `Object.getPrototypeOf(B.prototype)`, target: `Object.getPrototypeOf(B)` }),
  },
  { name: "extends-picked", define: action => ({ text: `var picked;\nconst table = { other: Object, undefined: A };\nfunction pickedKey() { return picked; }\nclass B extends table[pickedKey()] {\n${classBody(action)}}\npicked = "other";\n`, make: `new B(1, "two")` }) },
  { name: "extends-laundered", define: action => ({ text: `class B extends launder(A) {\n${classBody(action)}}\n`, make: `new B(1, "two")` }), needsOutsideHelpers: true },
  { name: "factory-over-laundered", define: action => ({ text: `const mix = Base => class extends Base {\n${classBody(action)}};\nconst B = mix(launder(A));\n`, make: `new B(1, "two")` }), needsOutsideHelpers: true },
  { name: "outside-constructs", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `constructIt(B, 1, "two")` }), needsOutsideHelpers: true },
  { name: "outside-constructs-base", define: () => ({ text: `const B = A;\n`, make: `constructIt(A, 1, "two")`, prototype: undefined }), skipsOtherConstructor: true, needsOutsideHelpers: true },
  { name: "outside-constructs-for-subclass", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `constructFor(A, B, 1, "two")` }), skipsOtherConstructor: true, needsOutsideHelpers: true },
  { name: "outside-constructs-for-class", define: action => ({ text: `class B {\n${classBody(action)}}\n`, make: `constructFor(A, B, 1, "two")` }), skipsOtherConstructor: true, needsOutsideHelpers: true },
  { name: "reflect-laundered-base", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `Reflect.construct(launder(A), [1, "two"], B)` }), skipsOtherConstructor: true, needsOutsideHelpers: true },
  { name: "reflect-laundered-target", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `Reflect.construct(A, [1, "two"], launder(B))` }), skipsOtherConstructor: true, needsOutsideHelpers: true },
  { name: "two-levels", define: action => ({ text: `class Middle extends A {}\nclass B extends Middle {\n${classBody(action)}}\n`, make: `new B(1, "two")` }) },
  { name: "two-levels-members-in-middle", define: action => ({ text: `class Middle extends A {\n${classBody(action)}}\nclass B extends Middle {}\n`, make: `new B(1, "two")`, prototype: `Middle.prototype`, target: `Middle` }) },
  { name: "class-in-function", define: action => ({ text: `function declare() {\n  return class extends A {\n${classBody(action)}  };\n}\nconst B = declare();\n`, make: `new B(1, "two")` }) },
  { name: "class-in-property", define: action => ({ text: `const holder = { B: class extends A {\n${classBody(action)}} };\nconst B = holder.B;\n`, make: `new holder.B(1, "two")` }) },
  { name: "reflect-class", define: action => ({ text: `class B {\n${classBody(action)}}\n`, make: `Reflect.construct(A, [1, "two"], B)` }), skipsOtherConstructor: true },
  { name: "reflect-subclass", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `Reflect.construct(A, [1, "two"], B)` }), skipsOtherConstructor: true },
  { name: "reflect-function", define: action => ({ text: `function B() {}\nB.prototype = {\n${inLiteral(action.otherMembers)}};\n`, make: `Reflect.construct(A, [1, "two"], B)` }), usesLiteral: true, skipsOtherConstructor: true },
  { name: "reflect-function-heir", define: action => ({ text: `function B() {}\nB.prototype = {\n  __proto__: A.prototype,\n${inLiteral(action.otherMembers)}};\n`, make: `Reflect.construct(A, [1, "two"], B)` }), usesLiteral: true, skipsOtherConstructor: true },
  { name: "reflect-prototype-not-object", define: () => ({ text: `function B() {}\nB.prototype = 1;\n`, make: `Reflect.construct(A, [1, "two"], B)`, prototype: undefined }), skipsOtherConstructor: true },
  { name: "reflect-bound", define: action => ({ text: `class Target extends A {\n${classBody(action)}}\nconst B = Target.bind(null);\n`, make: `Reflect.construct(A, [1, "two"], B)`, prototype: `Target.prototype`, target: `Target` }), skipsOtherConstructor: true },
  { name: "reflect-proxy", define: action => ({ text: `class Target extends A {\n${classBody(action)}}\nconst B = new Proxy(Target, {});\n`, make: `Reflect.construct(A, [1, "two"], B)`, prototype: `Target.prototype`, target: `Target` }), skipsOtherConstructor: true },
  {
    name: "reflect-proxy-with-trap",
    define: action => ({
      text: `const given = {\n  __proto__: A.prototype,\n${inLiteral(action.otherMembers)}};\nconst B = new Proxy(function () {}, { get(target, key) { return key === "prototype" ? given : target[key]; } });\n`,
      make: `Reflect.construct(A, [1, "two"], B)`,
      prototype: `given`,
    }),
    usesLiteral: true,
    skipsOtherConstructor: true,
  },
  { name: "reflect-subclass-for-base", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `Reflect.construct(B, [1, "two"], A)` }) },
  { name: "reflect-subclass-for-itself", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `Reflect.construct(B, [1, "two"])` }) },
  { name: "reflect-subclass-for-stranger", define: action => ({ text: `class B extends A {\n${classBody(action)}}\nclass Stranger { m() { return "Stranger.m"; } }\n`, make: `Reflect.construct(B, [1, "two"], Stranger)` }) },
  { name: "new-bound", define: action => ({ text: `class Target extends A {\n${classBody(action)}}\nconst B = Target.bind(null, 1);\n`, make: `new B("two")`, prototype: `Target.prototype`, target: `Target` }) },
  { name: "new-bound-base", define: () => ({ text: `const B = A.bind(null, 1);\n`, make: `new B("two")`, prototype: undefined }), skipsOtherConstructor: true },
  { name: "new-proxy", define: action => ({ text: `class Target extends A {\n${classBody(action)}}\nconst B = new Proxy(Target, {});\n`, make: `new B(1, "two")`, prototype: `Target.prototype`, target: `Target` }) },
  { name: "new-proxy-of-base", define: () => ({ text: `const B = new Proxy(A, {});\n`, make: `new B(1, "two")`, prototype: undefined }), skipsOtherConstructor: true },
  {
    name: "super-after-set-prototype-of",
    define: action => ({ text: `class First { constructor() { this.first = "First"; } m() { return "First.m"; } }\nclass B extends First {\n${classBody(action)}}\nObject.setPrototypeOf(B, A);\n`, make: `new B(1, "two")` }),
  },
  {
    name: "super-away-from-base",
    define: action => ({ text: `class Second { constructor() { this.second = "Second"; } m() { return "Second.m"; } }\nclass B extends A {\n${classBody(action)}}\ntry { new B(0, "zero"); } catch {}\nObject.setPrototypeOf(B, Second);\n`, make: `new B(1, "two")` }),
  },
  { name: "derived-returns-another", define: action => ({ text: `const replacement = { replaced: true };\nclass B extends A {\n${classBody(action, `  constructor(p, q) { super(p, q); return replacement; }\n`)}}\n`, make: `new B(1, "two")` }) },
  { name: "prototype-property-replaced", define: action => ({ text: `function B() {}\nB.prototype = {\n  __proto__: A.prototype,\n${inLiteral(action.otherMembers)}};\nconst saved = A.prototype;\n`, make: `Reflect.construct(A, [1, "two"], B)` }), usesLiteral: true, skipsOtherConstructor: true },
  { name: "native-constructs", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `Array.of.call(B, 1, "two")` }) },
  { name: "call-with-create", define: action => ({ text: `function B(p, q) { A.call(this, p, q); }\nB.prototype = Object.create(A.prototype);\nB.prototype.constructor = B;\n${onPrototype("B", action.otherMembers)}`, make: `new B(1, "two")` }), needsFunctionBase: true, skipsOtherConstructor: true, usesLiteral: true },
  { name: "call-with-set-prototype-of", define: action => ({ text: `function B(p, q) { A.call(this, p, q); }\nObject.setPrototypeOf(B.prototype, A.prototype);\n${onPrototype("B", action.otherMembers)}`, make: `new B(1, "two")` }), needsFunctionBase: true, skipsOtherConstructor: true, usesLiteral: true },
  { name: "apply-with-instance-as-prototype", define: action => ({ text: `function B() { A.apply(this, arguments); }\nB.prototype = new A(0, "zero");\n${onPrototype("B", action.otherMembers)}`, make: `new B(1, "two")` }), needsFunctionBase: true, skipsOtherConstructor: true, usesLiteral: true, constructsBaseItself: true },
  { name: "call-on-literal", define: action => ({ text: `const B = function () {};\nconst receiver = {\n${inLiteral(action.otherMembers)}};\n`, make: `(A.call(receiver, 1, "two"), receiver)`, prototype: `receiver` }), needsFunctionBase: true, skipsOtherConstructor: true, usesLiteral: true },
  { name: "static-factory", define: action => ({ text: `A.create = function (p, q) { return new this(p, q); };\nclass B extends A {\n${classBody(action)}}\n`, make: `B.create(1, "two")` }) },
  { name: "constructor-property", define: action => ({ text: `class B extends A {\n${classBody(action)}}\nfunction again(o) { return new o.constructor(1, "two"); }\n`, make: `again(B.prototype)` }) },
  { name: "reflect-construct-called", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `Reflect.construct.call(null, A, [1, "two"], B)` }), skipsOtherConstructor: true },
  { name: "reflect-construct-applied", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `Reflect.construct.apply(null, [A, [1, "two"], B])` }), skipsOtherConstructor: true },
  { name: "reflect-construct-bound", define: action => ({ text: `class B extends A {\n${classBody(action)}}\nconst construct = Reflect.construct.bind(null, A, [1, "two"]);\n`, make: `construct(B)` }), skipsOtherConstructor: true },
  { name: "reflect-apply-of-reflect-construct", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `Reflect.apply(Reflect.construct, null, [A, [1, "two"], B])` }), skipsOtherConstructor: true },
  { name: "reflect-construct-as-callback", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `[B].map(Reflect.construct.bind(null, A, [1, "two"]))[0]` }), skipsOtherConstructor: true, usesLibraryFunctions: true },
  { name: "reflect-target-from-table", define: action => ({ text: `class B extends A {\n${classBody(action)}}\nclass Stranger { m() { return "Stranger.m"; } }\nconst targets = [Stranger, B, A];\nlet turn = 0;\n`, make: `Reflect.construct(A, [1, "two"], targets[++turn % 3])` }), skipsOtherConstructor: true },
  { name: "reflect-middle-for-lowest", define: action => ({ text: `class Middle extends A { constructor(p, q) { super(p, q); this.middle = "middle"; } }\nclass B extends Middle {\n${classBody(action)}}\n`, make: `Reflect.construct(Middle, [1, "two"], B)` }), skipsOtherConstructor: true },
  { name: "extends-proxy-of-base", define: action => ({ text: `class B extends new Proxy(A, {}) {\n${classBody(action)}}\n`, make: `new B(1, "two")` }) },
  { name: "extends-bound-base", define: action => ({ text: `const Bound = A.bind(null);\nObject.defineProperty(Bound, "prototype", { value: A.prototype });\nclass B extends Bound {\n${classBody(action)}}\n`, make: `new B(1, "two")` }) },
  { name: "super-in-arrow", define: action => ({ text: `class B extends A {\n${classBody(action, `  constructor(p, q) { const run = () => super(p, q); run(); }\n`)}}\n`, make: `new B(1, "two")` }) },
  { name: "super-in-callback", define: action => ({ text: `class B extends A {\n${classBody(action, `  constructor(p, q) { [0].forEach(() => { super(p, q); }); }\n`)}}\n`, make: `new B(1, "two")` }), usesLibraryFunctions: true },
  { name: "super-on-two-paths", define: action => ({ text: `class B extends A {\n${classBody(action, `  constructor(p, q) { if (p === 1) super(p, q); else super(q, p); }\n`)}}\n`, make: `new B(1, "two")` }) },
  { name: "super-in-try", define: action => ({ text: `class B extends A {\n${classBody(action, `  constructor(p, q) { try { super(p, q); } finally { B.finished = (B.finished ?? 0) + 1; } }\n`)}}\n`, make: `new B(1, "two")` }) },
  { name: "derived-reads-after-super", define: action => ({ text: `class B extends A {\n${classBody(action, `  constructor(p, q) { super(p, q); this.sawR = this.r; this.sawX = this.x; this.sawM = typeof this.m; }\n`)}}\n`, make: `new B(1, "two")` }) },
  { name: "prototype-of-prototype-replaced", define: action => ({ text: `class B extends A {\n${classBody(action)}}\nObject.setPrototypeOf(B.prototype, { __proto__: A.prototype, between: true });\n`, make: `new B(1, "two")` }) },
  { name: "prototype-of-prototype-cut", define: action => ({ text: `class B extends A {\n${classBody(action)}}\nObject.setPrototypeOf(B.prototype, null);\n`, make: `new B(1, "two")` }) },
  { name: "array-from-constructs", define: action => ({ text: `class B extends A {\n${classBody(action)}}\n`, make: `Array.from.call(B, [])` }), usesLibraryFunctions: true },
  { name: "two-subclasses", define: action => ({ text: `class Sibling extends A { s = "sibling"; m() { return "Sibling.m"; } }\nclass B extends A {\n${classBody(action)}}\ntry { new Sibling(0, "zero"); } catch {}\n`, make: `new B(1, "two")` }) },
  { name: "subclass-defined-after-first-construction", define: action => ({ text: `try { new A(0, "zero"); } catch {}\nclass B extends A {\n${classBody(action)}}\n`, make: `new B(1, "two")` }) },
  { name: "super-after-proto-assignment", define: action => ({ text: `class First { constructor() { this.first = "First"; } m() { return "First.m"; } }\nclass B extends First {\n${classBody(action)}}\nB.__proto__ = A;\n`, make: `new B(1, "two")` }) },
  { name: "super-after-reflect-set-prototype-of", define: action => ({ text: `class First { constructor() { this.first = "First"; } m() { return "First.m"; } }\nclass B extends First {\n${classBody(action)}}\nReflect.setPrototypeOf(B, A);\nReflect.setPrototypeOf(B.prototype, A.prototype);\n`, make: `new B(1, "two")` }) },
  { name: "static-field-constructs", define: action => ({ text: `class B extends A {\n  static made = (() => { try { return new this(1, "two"); } catch (e) { return { failure: e }; } })();\n${classBody(action)}}\nfunction taken() { if (B.made.failure) throw B.made.failure; return B.made; }\n`, make: `taken()` }) },
  { name: "reflect-bound-with-prototype-getter", define: action => ({ text: `const given = {\n  __proto__: A.prototype,\n${inLiteral(action.otherMembers)}};\nlet reads = 0;\nconst B = function () {}.bind(null);\nObject.defineProperty(B, "prototype", { get() { reads++; return reads & 1 ? given : A.prototype; } });\n`, make: `Reflect.construct(A, [1, "two"], B)`, prototype: `given` }), usesLiteral: true, skipsOtherConstructor: true },
  { name: "native-constructs-proxy", define: action => ({ text: `class Target extends A {\n${classBody(action)}}\nconst B = new Proxy(Target, {});\n`, make: `Array.of.call(B, 1, "two")`, prototype: `Target.prototype`, target: `Target` }) },
  { name: "native-constructs-bound", define: action => ({ text: `class Target extends A {\n${classBody(action)}}\nconst B = Target.bind(null, 1, "two");\n`, make: `Array.of.call(B)`, prototype: `Target.prototype`, target: `Target` }) },
  { name: "derived-stores-through-super", define: action => ({ text: `class B extends A {\n${classBody(action, `  constructor(p, q) { super(p, q); super.x = "through super"; super.fresh = 1; }\n`)}}\n`, make: `new B(1, "two")` }) },
  { name: "prototype-replaced-between-constructions", define: action => ({ text: `function B() {}\nB.prototype = { __proto__: A.prototype, stale: true };\ntry { Reflect.construct(A, [0, "zero"], B); } catch {}\nB.prototype = {\n  __proto__: A.prototype,\n${inLiteral(action.otherMembers)}};\n`, make: `Reflect.construct(A, [1, "two"], B)` }), usesLiteral: true, skipsOtherConstructor: true },
  { name: "derived-touches-this-before-super", define: action => ({ text: `class B extends A {\n${classBody(action, `  constructor(p, q) { try { this.early = 1; } catch (e) { B.error = e.name; } super(p, q); this.error = B.error; }\n`)}}\n`, make: `new B(1, "two")` }) },
  { name: "derived-never-calls-super", define: action => ({ text: `class B extends A {\n${classBody(action, `  constructor(p, q) { if (p !== 1) super(p, q); }\n`)}}\n`, make: `new B(1, "two")` }) },
  { name: "super-called-twice", define: action => ({ text: `class B extends A {\n${classBody(action, `  constructor(p, q) { super(p, q); try { super(q, p); } catch (e) { this.second = e.name; } }\n`)}}\n`, make: `new B(1, "two")` }) },
  { name: "new-proxy-of-base-with-trap", define: action => ({ text: `const given = {\n  __proto__: A.prototype,\n${inLiteral(action.otherMembers)}};\nconst B = new Proxy(A, { get(target, key, receiver) { return key === "prototype" ? given : Reflect.get(target, key, receiver); } });\n`, make: `new B(1, "two")`, prototype: `given` }), usesLiteral: true, skipsOtherConstructor: true },
  { name: "native-constructs-proxy-with-trap", define: action => ({ text: `const given = {\n  __proto__: A.prototype,\n${inLiteral(action.otherMembers)}};\nconst B = new Proxy(A, { get(target, key, receiver) { return key === "prototype" ? given : Reflect.get(target, key, receiver); } });\n`, make: `Array.of.call(B, 1, "two")`, prototype: `given` }), usesLiteral: true, skipsOtherConstructor: true },
  { name: "outside-constructs-proxy-with-trap", define: action => ({ text: `const given = {\n  __proto__: A.prototype,\n${inLiteral(action.otherMembers)}};\nconst B = new Proxy(A, { get(target, key, receiver) { return key === "prototype" ? given : Reflect.get(target, key, receiver); } });\n`, make: `constructIt(B, 1, "two")`, prototype: `given` }), usesLiteral: true, skipsOtherConstructor: true, needsOutsideHelpers: true },
  { name: "proxy-with-construct-trap", define: action => ({ text: `class Target extends A {\n${classBody(action)}}\nconst B = new Proxy(A, { construct(target, list) { return Reflect.construct(target, list, Target); } });\n`, make: `new B(1, "two")`, prototype: `Target.prototype`, target: `Target` }), skipsOtherConstructor: true },
  {
    name: "transpiled-call-super",
    define: action => ({
      text: `${callSuperHelpers}var B = (function (_A) {\n  function B(p, q) {\n    var _this = _callSuper(this, B, [p, q]);\n${fieldsDefinedOn("_this", action.otherFields)}    return _this;\n  }\n  _inherits(B, _A);\n${definedOnPrototype("B", action.otherMembers)}  return B;\n})(A);\n`,
      make: `new B(1, "two")`,
    }),
    isTranspiled: true,
  },
  {
    name: "transpiled-extends",
    define: action => ({
      text: `${extendsHelper}function _defineProperty(e, r, t) { e[r] = t; return e; }\nvar B = (function (_super) {\n  __extends(B, _super);\n  function B(p, q) {\n    var _this = _super.call(this, p, q) || this;\n${fieldsDefinedOn("_this", action.otherFields)}    return _this;\n  }\n${definedOnPrototype("B", action.otherMembers)}  return B;\n})(A);\n`,
      make: `new B(1, "two")`,
    }),
    isTranspiled: true,
    needsFunctionBase: true,
  },
  { name: "inherits", define: action => ({ text: `function B(p, q) { A.call(this, p, q); }\nrequire("node:util").inherits(B, A);\n${onPrototype("B", action.otherMembers)}`, make: `new B(1, "two")` }), needsFunctionBase: true, skipsOtherConstructor: true, usesLiteral: true, usesLibraryFunctions: true },
];

type Context = "once" | "base-first" | "base-last" | "loop" | "function" | "twice" | "shared" | "in-for-each" | "in-every" | "in-map";
type Look = "direct" | "generic" | "local" | "copied";
const allContexts: Context[] = ["once", "base-first", "base-last", "loop", "function", "twice", "shared", "in-for-each", "in-every", "in-map"];
/** Contexts that call built-ins written in JavaScript. */
const contextsUsingLibraryFunctions: Context[] = ["in-for-each", "in-every", "in-map"];
const allLooks: Look[] = ["direct", "generic", "local", "copied"];
/** Looks that call built-ins written in JavaScript. */
const looksUsingLibraryFunctions: Look[] = ["copied"];

const helpers = `function str(v) {
  if (typeof v === "string") return '"' + v + '"';
  if (typeof v === "function") return "function";
  if (typeof v === "symbol") return "symbol";
  if (typeof v === "object" && v !== null) return "object";
  return "" + v;
}
`;
// What an Error object records about the place of its creation depends on the frames above it.
const positionHelper = `function saysWhereAnErrorWasMade(name) {
  return name === "line" || name === "column" || name === "sourceURL" || name === "stack" || name === "originalLine" || name === "originalColumn";
}
`;
const genericHelpers = `${positionHelper}function keysOf(o) {
  const keys = Object.keys(o);
  let text = "";
  for (let i = 0; i < keys.length; i++) text += (i ? "," : "") + keys[i] + "=" + str(o[keys[i]]);
  return text;
}
function namesOf(o) {
  const names = Object.getOwnPropertyNames(o);
  let text = "";
  for (let i = 0; i < names.length; i++) if (!saysWhereAnErrorWasMade(names[i])) text += (text ? "," : "") + names[i];
  return text;
}
`;

function lookAt(action: Action, variable: string, look: Look, label: string, indent: string): string {
  // A label that starts with "=" is the name of a variable that holds the label.
  const titled = (title: string) => (label.startsWith("=") ? `${label.slice(1)} + ${JSON.stringify(` ${title}: `)}` : JSON.stringify(`${label} ${title}: `));
  const lines = action.look.map(expression => `${indent}print(${titled(expression)} + str(${expression.replace(/\$(?!\{)/g, () => variable)}));\n`);
  lines.push(`${indent}print(${titled("instanceof A")} + (${variable} instanceof A));\n`);
  // No built-in is handed the object, so that it need not exist.
  if (look === "local") return lines.join("");
  lines.push(`${indent}print(${titled("has the prototype of A")} + (Object.getPrototypeOf(${variable}) === A.prototype));\n`);
  if (look === "copied") {
    lines.push(`${indent}print(${titled("spread")} + JSON.stringify({ ...${variable} }));\n`);
    lines.push(`${indent}print(${titled("assigned")} + JSON.stringify(Object.assign({}, ${variable})));\n`);
    lines.push(`${indent}print(${titled("entries")} + Object.entries(${variable}).map(([key, value]) => key + "=" + str(value)).join());\n`);
    lines.push(`${indent}print(${titled("values")} + Object.values(${variable}).map(str).join());\n`);
    lines.push(`${indent}print(${titled("own keys")} + Reflect.ownKeys(${variable}).map(String).filter(name => !saysWhereAnErrorWasMade(name)).join());\n`);
    lines.push(`${indent}print(${titled("descriptors")} + Object.entries(Object.getOwnPropertyDescriptors(${variable})).filter(([key]) => !saysWhereAnErrorWasMade(key)).map(([key, d]) => key + ":" + ("value" in d ? "v" : "a") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "")).join());\n`);
    lines.push(`${indent}print(${titled("tag")} + Object.prototype.toString.call(${variable}) + " " + (${variable}.constructor && ${variable}.constructor.name));\n`);
  }
  if (look === "generic") {
    lines.push(`${indent}print(${titled("keys")} + keysOf(${variable}));\n`);
    lines.push(`${indent}print(${titled("names")} + namesOf(${variable}));\n`);
    lines.push(`${indent}print(${titled("json")} + JSON.stringify(${variable}));\n`);
  }
  return lines.join("");
}

const guarded = (body: string, label: string) => `try {\n${body}} catch (e) {\n  print(${JSON.stringify(label + " threw ")} + e.name);\n}\n`;

export interface Combination {
  form: BaseForm;
  origin: Origin;
  action: Action;
  context: Context;
  look: Look;
}

function isPossible(form: BaseForm, origin: Origin, action: Action): boolean {
  if (isFunctionForm(form) && (action.baseFields || usesPrivateNames(action.baseMembers, undefined) || action.body.includes("#"))) return false;
  if (origin.needsFunctionBase && !isFunctionForm(form)) return false;
  if (origin.constructsBaseItself && action.refusesBaseItself) return false;
  if (origin.isTranspiled && (usesPrivateNames(action.otherMembers, action.otherFields) || usesSuper(action.otherMembers))) return false;
  if (origin.usesLiteral && usesPrivateNames(action.otherMembers, action.otherFields)) return false;
  if (origin.needsFunctionBase && usesSuper(action.otherMembers) && origin.name !== "call-on-literal") return false;
  return true;
}

export function textOf({ form, origin, action, context, look }: Combination, print = "print"): string {
  const defined = origin.define(action);
  const prototype = "prototype" in defined ? defined.prototype : "B.prototype";
  const target = defined.target ?? "B";
  const patch = prototype && action.patch ? action.patch(prototype, target) + "\n" : "";
  const base = `new A(1, "two")`;
  let run = "";
  switch (context) {
    case "once":
      run = guarded(`  const o = ${defined.make};\n${lookAt(action, "o", look, "o", "  ")}`, "o");
      break;
    case "base-first":
      run = guarded(`  const a = ${base};\n${lookAt(action, "a", look, "a", "  ")}`, "a") + guarded(`  const o = ${defined.make};\n${lookAt(action, "o", look, "o", "  ")}`, "o");
      break;
    case "base-last":
      run = guarded(`  const o = ${defined.make};\n${lookAt(action, "o", look, "o", "  ")}`, "o") + guarded(`  const a = ${base};\n${lookAt(action, "a", look, "a", "  ")}`, "a");
      break;
    case "loop":
      run = `for (let i = 0; i < 4; i++) {\n${guarded(`  const o = i & 1 ? ${defined.make} : ${base};\n${lookAt(action, "o", look, "o", "  ")}`, "o")}}\n`;
      break;
    case "in-for-each":
    case "in-every":
    case "in-map":
      run = `[false, true, false, true].${{ "in-for-each": "forEach", "in-every": "every", "in-map": "map" }[context]}(which => {\n${guarded(`  const o = which ? ${defined.make} : ${base};\n${lookAt(action, "o", look, "o", "  ")}`, "o")}  return true;\n});\n`;
      break;
    case "function":
      run = `function build(which) { return which ? ${defined.make} : ${base}; }\n` + guarded(`  const o = build(true);\n${lookAt(action, "o", look, "o", "  ")}`, "o") + guarded(`  const a = build(false);\n${lookAt(action, "a", look, "a", "  ")}`, "a");
      break;
    case "shared":
      run =
        `function report(label, x) {\n${lookAt(action, "x", look, "=label", "  ")}}\n` +
        guarded(`  report("a", ${base});\n`, "a") +
        guarded(`  report("o", ${defined.make});\n`, "o") +
        guarded(`  report("b", new B(1, "two"));\n`, "b") +
        guarded(`  report("again", ${defined.make});\n`, "again");
      break;
    case "twice":
      run = guarded(`  const o = ${defined.make};\n${lookAt(action, "o", look, "o", "  ")}`, "o") + guarded(`  const o = ${defined.make};\n${lookAt(action, "o", look, "second", "  ")}`, "second");
      break;
  }
  const after = (action.lookAfter ?? []).map(expression => guarded(`  print(${JSON.stringify(`after ${expression}: `)} + str(${expression}));\n`, `after ${expression}`)).join("");
  const header = print === "print" ? "" : `const print = text => ${print}(text);\n`;
  return `${header}${helpers}${look === "generic" ? genericHelpers : look === "copied" ? positionHelper : ""}${action.before ? action.before + "\n" : ""}${baseText(action, form)}${defined.text}${patch}${run}${after}`;
}

export const nameOf = ({ form, origin, action, context, look }: Combination) => `${form}.${origin.name}.${action.name}.${context}.${look}`;

export function combinations(contexts: Context[] = allContexts, looks: Look[] = allLooks): Combination[] {
  const result: Combination[] = [];
  for (const form of allForms)
    for (const origin of origins)
      for (const action of actions) {
        if (!isPossible(form, origin, action)) continue;
        for (const context of contexts) for (const look of looks) result.push({ form, origin, action, context, look });
      }
  return result;
}

/** One program for each form of the base and each origin: every action in the given contexts, each combination in a function of its own. */
export function programsByOrigin(contexts: Context[], looks: Look[]): { name: string; text: string }[] {
  const groups = Map.groupBy(
    combinations(contexts, looks).filter(combination => !combination.origin.needsOutsideHelpers),
    combination => `${combination.form}.${combination.origin.name}`,
  );
  return [...groups].map(([name, group]) => ({
    name,
    text: group.map(combination => `console.log(${JSON.stringify("## " + nameOf(combination))});
(() => {
${textOf(combination, "console.log")}})();
`).join(""),
  }));
}

/** One combination, drawn with `pick`. `hasLibrary`: built-ins written in JavaScript and the modules of the host are there. `hasOutsideHelpers`: launder, constructIt and constructFor are defined. */
export function pickCombination(pick: <T>(items: readonly T[]) => T, { hasLibrary, hasOutsideHelpers }: { hasLibrary: boolean; hasOutsideHelpers: boolean }): Combination {
  for (;;) {
    const combination = { form: pick(allForms), origin: pick(origins), action: pick(actions), context: pick(allContexts), look: pick(allLooks) };
    if (!isPossible(combination.form, combination.origin, combination.action)) continue;
    if (!hasOutsideHelpers && combination.origin.needsOutsideHelpers) continue;
    if (!hasLibrary && (isOverHostClass(combination.form) || combination.origin.usesLibraryFunctions || looksUsingLibraryFunctions.includes(combination.look) || contextsUsingLibraryFunctions.includes(combination.context))) continue;
    return combination;
  }
}

if (import.meta.main) {
  const folder = process.argv[2];
  const option = (name: string) => process.argv.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3);
  const filter = new RegExp(option("filter") ?? ".");
  const contexts = (option("contexts")?.split(",") as Context[]) ?? allContexts;
  const looks = (option("looks")?.split(",") as Look[]) ?? allLooks;
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (const combination of combinations(contexts, looks)) {
    if (!filter.test(nameOf(combination))) continue;
    writeFileSync(join(folder, nameOf(combination) + ".js"), textOf(combination, option("print") ?? "print"));
    written++;
  }
  console.log(`${written} programs`);
}
