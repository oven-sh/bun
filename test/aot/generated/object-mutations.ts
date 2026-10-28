// Programs about one question: an object is changed, and code that uses the object before and after the change sees what the language says it sees.
// The table is a cross product: what kind of object x what its prototypes hold under the key x which object is changed (itself, its prototype, the prototype above, its class) x the change x the key
// x how the key is spelled x when and where the change runs x how the object is looked at.
//
// Half of the looks read nothing: a store, a deletion or a definition whose only trace is an effect (a setter that runs, a TypeError, a proxy trap, a conversion).
// In such a program no code reads the property at all. Every effect goes through `note`, which counts it and appends it to `trail`.
// A look reads the count before and after, in the function that looks.
//
// One combination is one program: nothing else in it names the object or the key.
//
//   bun object-mutations.ts <folder> [--print=print|console.log] [--filter=<regex over names>] [--without-text=<regex over programs>] [--sample=<how many>] [--seed=<number>] [--names=<file with a name on each line>] [--library=no] [--extension=.js] [--group=<n>] [--planes]
//       [--holders=a,b] [--integrities=..] [--aboves=..] [--targets=..] [--operations=..] [--keys=..] [--presences=..] [--spellings=..] [--places=..] [--looks=..]
//
// writes <folder>/<name>.js. The whole product is far too large to write: narrow the axes, or pass --sample. `pickCombination` draws one of them for another driver.
// A program is strict code. With --extension=.cjs it has no directive and is sloppy code, where a store that fails is ignored.
// With --planes it writes the programs of `testPlanes` instead.
// With --group=<n> a file holds n combinations, each in a function of its own, and every line it prints starts with the number of its combination: many more combinations for each build,
// but a property that one combination reads is a property that the program reads.
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

type Spelling = "constant" | "computed";

interface Key {
  name: string;
  /** The key as a constant expression. */
  constant: string;
  /** The key as it stands in a literal or in a class body. */
  inLiteral: string;
  /** The name behind a dot, where the key is an identifier. */
  member?: string;
  /** An expression that puts the same key together while the program runs. */
  computed: string;
  before?: string;
  /** Declarations that `computed` needs. */
  beforeComputed?: string;
  /** What the object holds under the key from its creation on, where it has the key. */
  ownValue?: string;
  /** Programs call what stands under it. */
  isCalled?: boolean;
}

const named = (name: string, more: Partial<Key> = {}): Key => ({ name, constant: JSON.stringify(name), inLiteral: name, member: name, computed: `spell(${JSON.stringify(name)})`, ...more });
const bracketed = (name: string, more: Partial<Key> = {}): Key => ({ ...named(name, more), inLiteral: `[${JSON.stringify(name)}]` });
const text = (name: string, key: string): Key => ({ name, constant: JSON.stringify(key), inLiteral: JSON.stringify(key), computed: `spell(${JSON.stringify(key)})` });
const index = (name: string, key: number): Key => ({ name, constant: `${key}`, inLiteral: `${key}`, computed: `tally(${key})` });
const symbol = (name: string, expression: string, more: Partial<Key> = {}): Key => ({ name, constant: expression, inLiteral: `[${expression}]`, computed: `symbols[tally(1)]`, beforeComputed: `const symbols = [Symbol("other"), ${expression}];\n`, ...more });

const keys: Key[] = [
  named("k"),
  named("m", { ownValue: `function () { return "own m"; }`, isCalled: true }),
  index("index-0", 0),
  index("index-1", 1),
  index("index-7", 7),
  index("index-1000", 1000),
  text("text-0", "0"),
  text("text-minus-1", "-1"),
  text("text-fraction", "1.5"),
  text("text-largest-index", "4294967294"),
  text("text-past-largest-index", "4294967295"),
  text("text-leading-zero", "01"),
  symbol("own-symbol", "mark", { before: `const mark = Symbol("mark");\n` }),
  symbol("registered-symbol", `Symbol.for("shared")`),
  symbol("to-primitive", "Symbol.toPrimitive", { ownValue: `function (hint) { note("own toPrimitive " + hint); return 7; }`, isCalled: true }),
  symbol("to-string-tag", "Symbol.toStringTag", { ownValue: `"Tagged"` }),
  symbol("iterator", "Symbol.iterator", { ownValue: `function* () { note("own iterator"); yield 1; }`, isCalled: true }),
  symbol("has-instance", "Symbol.hasInstance", { ownValue: `function () { note("own hasInstance"); return true; }`, isCalled: true }),
  symbol("is-concat-spreadable", "Symbol.isConcatSpreadable", { ownValue: `true` }),
  bracketed("__proto__"),
  bracketed("constructor", { isCalled: true }),
  bracketed("prototype"),
  named("length"),
  named("name"),
  named("message"),
  named("size"),
  named("value"),
  named("done"),
  named("index"),
  named("lastIndex"),
  named("raw"),
  named("then", { ownValue: `function (resolve) { note("own then"); resolve(1); }`, isCalled: true }),
  named("toJSON", { ownValue: `function () { note("own toJSON"); return "json"; }`, isCalled: true }),
  named("valueOf", { ownValue: `function () { note("own valueOf"); return 7; }`, isCalled: true }),
  named("toString", { ownValue: `function () { note("own toString"); return "text"; }`, isCalled: true }),
];

const access = (object: string, key: Key, spelling: Spelling) => (spelling === "computed" ? `${object}[name]` : key.member ? `${object}.${key.member}` : `${object}[${key.constant}]`);

interface Property {
  key: Key;
  value: string;
}

const asLiteral = (own: Property[]) => own.map(({ key, value }) => `${key.inLiteral}: ${value}`).join(", ");
const asFields = (own: Property[], prefix = "") => own.map(({ key, value }) => `  ${prefix}${key.inLiteral} = ${value};\n`).join("");
const asStores = (object: string, own: Property[]) => own.map(({ key, value }) => `${access(object, key, "constant")} = ${value};`).join(" ");
const asDescriptors = (own: Property[]) => own.map(({ key, value }) => `${key.inLiteral}: { value: ${value}, writable: true, enumerable: true, configurable: true }`).join(", ");

interface Members {
  inClass: string;
  inLiteral: string;
}

interface Holder {
  name: string;
  /** What the program imports: the names and the module. */
  imports?: [names: string, module: string];
  /** Declarations in front of `make`. `own` lists the properties that the object has from its creation on, in their order. `members` is what stands beside them or above them: the method `m`, and what the combination declares. */
  define?: (own: Property[], members: Members) => string;
  /** The body of `make`, which answers another object each time. */
  make: (own: Property[], members: Members) => string;
  /** `members` stands in a class or a literal above the object. */
  declaresMembersAbove?: boolean;
  /** The prototype of the object and the prototype above it, where they belong to the program. */
  proto?: string;
  grand?: string;
  /** What `instanceof` is asked about. */
  class?: string;
  /** It has elements and a length. */
  isArrayLike?: boolean;
  /** It inherits the methods of arrays. */
  isArray?: boolean;
  isCallable?: boolean;
  /** It is a function that the program wrote inside a literal or a class. `hosts` lists what it is read from, under the name `made`. */
  hasHost?: boolean;
  /** Its name comes from a computed key. Plain Bun leaves that name out of the name of a function bound to it. */
  isNamedByComputedKey?: boolean;
  /** Object.freeze and Object.seal throw for it. */
  refusesFreeze?: boolean;
  /** Its properties are static fields, and a static field named "prototype" cannot be defined. */
  hasStaticFields?: boolean;
  /** The namespace of the program's own module: the program imports itself by the name of its file, and its properties are exports. */
  isNamespace?: boolean;
  usesLibrary?: boolean;
}

const half = (own: Property[]) => [own.slice(0, own.length - 1), own.slice(own.length - 1)];
const loggingHandler = `{
  get(target, key, receiver) { note("trap get " + String(key)); return Reflect.get(target, key, receiver); },
  set(target, key, value, receiver) { note("trap set " + String(key)); return Reflect.set(target, key, value, receiver); },
  has(target, key) { note("trap has " + String(key)); return Reflect.has(target, key); },
  deleteProperty(target, key) { note("trap delete " + String(key)); return Reflect.deleteProperty(target, key); },
  defineProperty(target, key, descriptor) { note("trap define " + String(key)); return Reflect.defineProperty(target, key, descriptor); },
  getOwnPropertyDescriptor(target, key) { note("trap describe " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
  ownKeys(target) { note("trap keys"); return Reflect.ownKeys(target); },
  getPrototypeOf(target) { note("trap prototype"); return Reflect.getPrototypeOf(target); },
  setPrototypeOf(target, prototype) { note("trap set prototype"); return Reflect.setPrototypeOf(target, prototype); },
  isExtensible(target) { note("trap extensible"); return Reflect.isExtensible(target); },
  preventExtensions(target) { note("trap prevent"); return Reflect.preventExtensions(target); },
}`;

const holders: Holder[] = [
  { name: "literal", make: (own, members) => `return { ${members.inLiteral}, ${asLiteral(own)} };` },
  { name: "literal-filled-later", make: own => `const made = {}; ${asStores("made", own)} made.m = function () { return "m"; }; return made;` },
  {
    name: "literal-with-prototype",
    declaresMembersAbove: true,
    define: (_own, members) => `const grand = { inherited: "grand" };\nconst parent = { __proto__: grand, ${members.inLiteral} };\n`,
    make: own => `return { __proto__: parent, ${asLiteral(own)} };`,
    proto: "parent",
    grand: "grand",
  },
  { name: "class-fields", declaresMembersAbove: true, define: (own, members) => `class A {\n${asFields(own)}  ${members.inClass}\n}\n`, make: () => `return new A();`, proto: "A.prototype", class: "A" },
  { name: "class-constructor", declaresMembersAbove: true, define: (own, members) => `class A {\n  constructor() { ${asStores("this", own)} }\n  ${members.inClass}\n}\n`, make: () => `return new A();`, proto: "A.prototype", class: "A" },
  {
    name: "class-private-beside",
    define: own => `class A {\n  #hidden = 7;\n${asFields(own)}  #last = 8;\n  m() { return "m" + this.#hidden + this.#last; }\n}\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    class: "A",
  },
  {
    name: "class-stores-in-method",
    declaresMembersAbove: true,
    define: (own, members) => `class A {\n  constructor() { this.fill(); }\n  fill() { ${asStores("this", own)} }\n  ${members.inClass}\n}\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    class: "A",
  },
  {
    name: "subclass",
    declaresMembersAbove: true,
    define: (own, members) => `class Base {\n  constructor() { ${asStores("this", half(own)[0])} }\n  ${members.inClass}\n}\nclass A extends Base {\n  constructor() { super(); ${asStores("this", half(own)[1])} }\n}\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    grand: "Base.prototype",
    class: "A",
  },
  {
    name: "subclass-fields",
    declaresMembersAbove: true,
    define: (own, members) => `class Base {\n${asFields(own.slice(0, 1))}  ${members.inClass}\n}\nclass A extends Base {\n${asFields(own.slice(1))}}\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    grand: "Base.prototype",
    class: "A",
  },
  {
    name: "subclass-without-constructor",
    declaresMembersAbove: true,
    define: (own, members) => `class Base {\n  constructor() { ${asStores("this", own)} }\n  ${members.inClass}\n}\nclass A extends Base {}\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    grand: "Base.prototype",
    class: "A",
  },
  {
    name: "mixin",
    declaresMembersAbove: true,
    define: (own, members) => `const mix = Parent => class extends Parent {\n${asFields(own.slice(1))}};\nclass Base {\n${asFields(own.slice(0, 1))}  ${members.inClass}\n}\nconst A = mix(Base);\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    grand: "Base.prototype",
    class: "A",
  },
  {
    name: "constructor-function",
    define: own => `function A() { ${asStores("this", own)} }\nA.prototype.m = function () { return "m"; };\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    class: "A",
  },
  {
    name: "constructor-function-with-parent",
    define: own =>
      `function Base() { ${asStores("this", half(own)[0])} }\nBase.prototype.m = function () { return "m"; };\nfunction A() { Base.call(this); ${asStores("this", half(own)[1])} }\nA.prototype = Object.create(Base.prototype);\nA.prototype.constructor = A;\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    grand: "Base.prototype",
    class: "A",
  },
  {
    name: "class-over-function",
    define: own => `function Base() { ${asStores("this", half(own)[0])} }\nBase.prototype.m = function () { return "m"; };\nclass A extends Base {\n${asFields(half(own)[1])}}\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    grand: "Base.prototype",
    class: "A",
  },
  {
    name: "two-classes",
    declaresMembersAbove: true,
    define: (own, members) => `class A {\n${asFields(own)}  ${members.inClass}\n}\nclass Other {\n${asFields([...own].reverse())}  ${members.inClass}\n}\nlet turn = 0;\n`,
    make: () => `return turn++ & 1 ? new Other() : new A();`,
  },
  {
    name: "created",
    define: () => `const grand = { inherited: "grand" };\nconst parent = Object.create(grand);\nparent.m = function () { return "m"; };\n`,
    make: own => `const made = Object.create(parent); ${asStores("made", own)} return made;`,
    proto: "parent",
    grand: "grand",
  },
  { name: "created-without-prototype", make: own => `const made = Object.create(null); ${asStores("made", own)} made.m = function () { return "m"; }; return made;` },
  { name: "created-with-descriptors", declaresMembersAbove: true, define: (_own, members) => `const parent = { ${members.inLiteral} };\n`, make: own => `return Object.create(parent, { ${asDescriptors(own)} });`, proto: "parent" },
  { name: "parsed", make: own => `const made = JSON.parse('{"first":0}'); ${asStores("made", own)} return made;` },
  { name: "spread-copy", define: (own, members) => `const source = { ${members.inLiteral}, ${asLiteral(own)} };\n`, make: () => `return { ...source };` },
  { name: "assigned-copy", define: (own, members) => `const source = { ${members.inLiteral}, ${asLiteral(own)} };\n`, make: () => `return Object.assign({}, source);` },
  { name: "array", make: own => `const made = [10, 20, 30]; ${asStores("made", own.slice(1, -1))} return made;`, isArrayLike: true, isArray: true },
  { name: "array-of-doubles", make: own => `const made = [1.5, 2.5, 3.5]; ${asStores("made", own.slice(1, -1))} return made;`, isArrayLike: true, isArray: true },
  { name: "array-of-objects", make: own => `const made = [{}, "text", null]; ${asStores("made", own.slice(1, -1))} return made;`, isArrayLike: true, isArray: true },
  { name: "array-with-hole", make: own => `const made = [10, , 30]; ${asStores("made", own.slice(1, -1))} return made;`, isArrayLike: true, isArray: true },
  { name: "array-pushed", make: own => `const made = []; made.push(10); made.push(20); made.push(30); ${asStores("made", own.slice(1, -1))} return made;`, isArrayLike: true, isArray: true },
  {
    name: "array-subclass",
    declaresMembersAbove: true,
    define: (_own, members) => `class A extends Array {\n  ${members.inClass}\n}\n`,
    make: own => `const made = new A(); made.push(10, 20, 30); ${asStores("made", own.slice(1, -1))} return made;`,
    proto: "A.prototype",
    class: "A",
    isArrayLike: true,
    isArray: true,
  },
  { name: "array-like", make: own => `return { 0: 10, 1: 20, 2: 30, length: 3, ${asLiteral(own.slice(1, -1))} };`, isArrayLike: true },
  { name: "arguments", make: own => `const made = (function (p, q, r) { return arguments; })(10, 20, 30); ${asStores("made", own.slice(1, -1))} return made;`, isArrayLike: true },
  { name: "function", make: own => `function made(p, q) { return "called"; } ${asStores("made", own)} return made;`, isCallable: true },
  { name: "arrow-function", make: own => `const made = p => "called"; ${asStores("made", own)} return made;`, isCallable: true },
  { name: "bound-function", define: () => `function target(p, q) { return "called"; }\n`, make: own => `const made = target.bind(null, 1); ${asStores("made", own)} return made;`, isCallable: true },
  { name: "class-statics", make: own => `return class Made {\n${asFields(own, "static ")}  static m() { return "m"; }\n};`, isCallable: true, hasStaticFields: true },
  {
    name: "subclass-statics",
    define: own => `class Base {\n${asFields(half(own)[0], "static ")}  static m() { return "m"; }\n}\n`,
    make: own => `return class Made extends Base {\n${asFields(half(own)[1], "static ")}};`,
    proto: "Base",
    isCallable: true,
    hasStaticFields: true,
  },
  { name: "prototype-object", make: (own, members) => `class Made {\n  ${members.inClass}\n}\n${asStores("Made.prototype", own)} return Made.prototype;` },
  {
    name: "map-subclass",
    declaresMembersAbove: true,
    define: (own, members) => `class A extends Map {\n  constructor() { super(); ${asStores("this", own)} }\n  ${members.inClass}\n}\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    class: "A",
  },
  {
    name: "error-subclass",
    declaresMembersAbove: true,
    define: (own, members) => `class A extends Error {\n  constructor() { super("failed"); ${asStores("this", own)} }\n  ${members.inClass}\n}\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    class: "A",
  },
  {
    name: "promise-subclass",
    declaresMembersAbove: true,
    define: (own, members) => `class A extends Promise {\n  constructor(executor = () => {}) { super(executor); ${asStores("this", own)} }\n  ${members.inClass}\n}\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    class: "A",
  },
  {
    name: "bytes-subclass",
    declaresMembersAbove: true,
    define: (own, members) => `class A extends Uint8Array {\n  constructor() { super(3); this[0] = 10; this[1] = 20; this[2] = 30; ${asStores("this", own.slice(1, -1))} }\n  ${members.inClass}\n}\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    class: "A",
    isArrayLike: true,
    refusesFreeze: true,
  },
  { name: "bytes", make: own => `const made = new Uint8Array([10, 20, 30]); ${asStores("made", own.slice(1, -1))} return made;`, isArrayLike: true, refusesFreeze: true },
  {
    name: "emitter-subclass",
    declaresMembersAbove: true,
    imports: ["{ EventEmitter }", "node:events"],
    define: (own, members) => `class A extends EventEmitter {\n  constructor() { super(); ${asStores("this", own)} }\n  ${members.inClass}\n}\n`,
    make: () => `return new A();`,
    proto: "A.prototype",
    class: "A",
    usesLibrary: true,
  },
  { name: "text-object", make: own => `const made = new String("abc"); ${asStores("made", own.slice(1, -1))} return made;`, isArrayLike: true },
  { name: "proxy-of-instance", declaresMembersAbove: true, define: (own, members) => `class A {\n${asFields(own)}  ${members.inClass}\n}\n`, make: () => `return new Proxy(new A(), {});`, proto: "A.prototype", class: "A" },
  { name: "logging-proxy-of-instance", declaresMembersAbove: true, define: (own, members) => `class A {\n${asFields(own)}  ${members.inClass}\n}\nconst handler = ${loggingHandler};\n`, make: () => `return new Proxy(new A(), handler);`, proto: "A.prototype", class: "A" },
  { name: "logging-proxy-of-literal", define: () => `const handler = ${loggingHandler};\n`, make: (own, members) => `return new Proxy({ ${members.inLiteral}, ${asLiteral(own)} }, handler);` },
  {
    name: "module-namespace",
    define: own => `import * as self from "./FILE";\n${own.map(({ key, value }, i) => `let binding${i} = ${value};\nexport { binding${i} as ${key.member} };\n`).join("")}export function m() { return "m"; }\n`,
    make: () => `return self;`,
    isNamespace: true,
  },
  // Functions written inside a literal or a class. Every store of `make` reads the function from its host again.
  ...(
    [
      ["method-in-literal", `const host = { beside: 1, made(p, q) { return "called"; } };`],
      ["function-in-literal", `const host = { beside: 1, made: function (p, q) { return "called"; } };`],
      ["named-function-in-literal", `const host = { beside: 1, made: function inner(p, q) { return "called"; } };`],
      ["arrow-in-literal", `const host = { beside: 1, made: p => "called" };`],
      ["capturing-arrow-in-literal", `const captured = hosts.length;\nconst host = { beside: 1, made: p => "called " + captured };`],
      ["method-using-this-in-literal", `const host = { beside: 1, made(p, q) { return "called " + typeof this; } };`],
      ["method-using-super-in-literal", `const host = { __proto__: { base() { return "base"; } }, made(p, q) { return "called " + super.base(); } };`],
      ["async-method-in-literal", `const host = { beside: 1, async made(p, q) { return "called"; } };`],
      ["generator-method-in-literal", `const host = { beside: 1, *made(p, q) { yield "called"; } };`],
      ["computed-method-in-literal", `const host = { beside: 1, ["ma" + "de"](p, q) { return "called"; } };`, { isNamedByComputedKey: true }],
      ["getter-of-literal", `const inner = { get value() { return "called"; } };\nconst host = { get made() { return Object.getOwnPropertyDescriptor(inner, "value").get; } };`],
      ["method-in-nested-literal", `const outer = { inner: { beside: 1, made(p, q) { return "called"; } } };\nconst host = outer.inner;`],
      ["method-in-returned-literal", `const build = () => ({ beside: 1, made(p, q) { return "called"; } });\nconst host = build();`],
      ["method-in-spread-copy", `const host = { ...{ beside: 1, made(p, q) { return "called"; } } };`],
      ["method-in-frozen-literal", `const host = Object.freeze({ beside: 1, made(p, q) { return "called"; } });`],
      ["function-in-array-literal", `const list = [function (p, q) { return "called"; }];\nconst host = { get made() { return list[0]; } };`],
      ["class-in-literal", `const host = { beside: 1, made: class { static m() { return "m"; } } };`],
      ["method-in-class", `class Host { made(p, q) { return "called"; } }\nconst host = Host.prototype;`],
      ["static-method-in-class", `class Host { static made(p, q) { return "called"; } }\nconst host = Host;`],
      ["arrow-in-field", `class Host { made = p => "called"; }\nconst host = new Host();`],
      ["private-method-in-class", `class Host { #hidden(p, q) { return "called"; } get made() { return this.#hidden; } }\nconst host = new Host();`],
    ] as [string, string, Partial<Holder>?][]
  ).map(
    ([name, host, more]): Holder => ({ name, define: () => `const hosts = [];\n`, make: own => `${host}\n${asStores("host.made", own)}\nhosts.push(host);\nreturn host.made;`, isCallable: true, hasHost: true, ...more }),
  ),
  // Objects that built-ins and the language make.
  ...(
    [
      ["iterator-result", `(function* () { yield 1; })().next()`, { usesLibrary: true }],
      ["array-iterator-result", `[1].values().next()`, { usesLibrary: true }],
      ["descriptor-object", `Object.getOwnPropertyDescriptor({ x: 1 }, "x")`],
      ["match-result", `/b/.exec("abc")`, { isArrayLike: true, isArray: true }],
      ["entry-pair", `Object.entries({ x: 1 })[0]`, { isArrayLike: true, isArray: true, usesLibrary: true }],
      ["split-result", `"10,20,30".split(",")`, { isArrayLike: true, isArray: true }],
      ["mapped-array", `[1, 2, 3].map(x => x * 10)`, { isArrayLike: true, isArray: true, usesLibrary: true }],
      ["keys-array", `Object.keys({ x: 1, y: 2, w: 3 })`, { isArrayLike: true, isArray: true }],
      ["rest-array", `((...all) => all)(10, 20, 30)`, { isArrayLike: true, isArray: true }],
      ["array-of-length", `new Array(3)`, { isArrayLike: true, isArray: true }],
      ["template-strings", `(strings => strings)\`x\${1}y\${2}w\``, { isArrayLike: true, isArray: true }],
      ["pattern", `/a/g`],
      ["date", `new Date(0)`],
      ["number-object", `new Number(5)`],
      ["symbol-object", `Object(Symbol("wrapped"))`],
      ["error", `new Error("failed")`],
      ["map", `new Map()`],
      ["set", `new Set()`],
      ["weak-map", `new WeakMap()`],
      ["promise", `Promise.resolve(1)`],
      ["resolvers", `Promise.withResolvers()`],
      ["array-buffer", `new ArrayBuffer(3)`],
      ["data-view", `new DataView(new ArrayBuffer(3))`],
      ["grouped", `Object.groupBy([1], () => "group")`, { usesLibrary: true }],
      ["from-entries", `Object.fromEntries([["first", 0]])`, { usesLibrary: true }],
      ["rest-object", `(({ dropped, ...rest }) => rest)({ dropped: 1, first: 0 })`],
      ["generator-object", `(function* () { yield 1; })()`],
      ["generator-function", `function* () { yield 1; }`, { isCallable: true }],
      ["async-function", `async function () {}`, { isCallable: true }],
      ["method", `({ method() {} }).method`, { isCallable: true }],
      ["getter-function", `Object.getOwnPropertyDescriptor({ get x() { return 1; } }, "x").get`, { isCallable: true }],
      ["buffer", `Buffer.from([10, 20, 30])`, { isArrayLike: true, refusesFreeze: true, usesLibrary: true }],
      ["url", `new URL("http://example.com/path")`, { usesLibrary: true }],
      ["headers", `new Headers({ x: "1" })`, { usesLibrary: true }],
    ] as [string, string, Partial<Holder>?][]
  ).map(([name, expression, more]): Holder => ({ name, make: own => `const made = ${expression}; ${asStores("made", more?.isArrayLike ? own.slice(1, -1) : own)} return made;`, ...more })),
  { name: "heir-of-instance", declaresMembersAbove: true, define: (own, members) => `class A {\n${asFields(own)}  ${members.inClass}\n}\nconst ancestor = new A();\n`, make: () => `return Object.create(ancestor);`, proto: "ancestor", grand: "A.prototype", class: "A" },
];

type Integrity = "open" | "frozen" | "sealed" | "not-extensible";
const integrities: Integrity[] = ["open", "frozen", "sealed", "not-extensible"];
const integrityFunctions = { frozen: "Object.freeze", sealed: "Object.seal", "not-extensible": "Object.preventExtensions" };

/** What lies above the object under the key before anything runs. */
interface Above {
  name: string;
  /** Members of the class or the literal that has `m`. */
  declared?: (key: string) => string[];
  /** A descriptor that is defined on the prototype, or on the prototype above it, once the declarations have run. */
  planted?: string;
  isFar?: boolean;
}

const getterAbove = `{ note("get above"); return "got above"; }`;
const setterAbove = `{ note("set above " + str(v)); }`;
const aboves: Above[] = [
  { name: "nothing-above" },
  { name: "declared-accessor", declared: key => [`get ${key}() ${getterAbove}`, `set ${key}(v) ${setterAbove}`] },
  { name: "declared-setter", declared: key => [`set ${key}(v) ${setterAbove}`] },
  { name: "declared-getter", declared: key => [`get ${key}() ${getterAbove}`] },
  { name: "declared-method", declared: key => [`${key}() { return "method above"; }`] },
  { name: "planted-accessor", planted: `{ get() ${getterAbove}, set(v) ${setterAbove}, enumerable: true, configurable: true }` },
  { name: "planted-setter", planted: `{ set(v) ${setterAbove}, configurable: true }` },
  { name: "planted-getter", planted: `{ get() ${getterAbove}, configurable: true }` },
  { name: "planted-read-only", planted: `{ value: "read-only above", writable: false, enumerable: true, configurable: true }` },
  { name: "planted-data", planted: `{ value: "data above", writable: true, enumerable: true, configurable: true }` },
  { name: "planted-hidden-data", planted: `{ value: "hidden above", writable: true, enumerable: false, configurable: true }` },
  { name: "planted-far-setter", planted: `{ set(v) ${setterAbove}, configurable: true }`, isFar: true },
  { name: "planted-far-read-only", planted: `{ value: "read-only above", writable: false, enumerable: true, configurable: true }`, isFar: true },
];

type Target = "itself" | "prototype" | "prototype-above" | "class-object";
const targets: Target[] = ["itself", "prototype", "prototype-above", "class-object"];

interface Site {
  /** The object that is changed or looked at. */
  object: string;
  /** The key as an expression. */
  key: string;
  /** The key as it stands in a literal. */
  inLiteral: string;
  /** The property of an object under the key. */
  at: (object: string) => string;
  holder: Holder;
  /** `object.name(arguments)` for a method of arrays. */
  arrayCall: (name: string, parameters?: string) => string;
}

interface Operation {
  name: string;
  text: (site: Site) => string;
  before?: (site: Site) => string;
  needsArrayLike?: boolean;
  /** It would turn a function under the key into its source text. */
  refusesCalledKey?: boolean;
  usesLibrary?: boolean;
}

const accessor = `get() { note("get"); return "got"; }, set(v) { note("set " + str(v)); }`;
const defines = (name: string, ...descriptors: string[]): Operation => ({ name, text: s => descriptors.map(descriptor => `Object.defineProperty(${s.object}, ${s.key}, ${descriptor});\n`).join("") });
const stores = (name: string, value: string): Operation => ({ name, text: s => `${s.at(s.object)} = ${value};\n` });
const setsPrototype = (name: string, prototype: (s: Site) => string): Operation => ({ name, text: s => `Object.setPrototypeOf(${s.object}, ${prototype(s)});\n` });
const adds = (count: number): Operation => ({ name: `add-${count}`, text: s => (count <= 65 ? Array.from({ length: count }, (_, i) => `${s.object}.p${i} = ${i};\n`).join("") : `for (let i = 0; i < ${count}; i++) ${s.object}["p" + i] = i;\n`) });
const onArray = (name: string, call: string, parameters = ""): Operation => ({ name, text: s => `${s.arrayCall(call, parameters)};\n`, needsArrayLike: true });
const stamp = (body: string) => `class Stamp extends function (given) { return given; } {\n  ${body}\n}\n`;
const proxyAbove = `new Proxy({}, {
  get(target, key, receiver) { note("above get " + String(key)); return undefined; },
  set(target, key, value, receiver) { note("above set " + String(key)); return Reflect.set(target, key, value, receiver); },
  has(target, key) { note("above has " + String(key)); return false; },
})`;

const operations: Operation[] = [
  defines("define-data", `{ value: "defined", writable: true, enumerable: true, configurable: true }`),
  defines("define-read-only", `{ value: "read-only", writable: false, enumerable: true, configurable: true }`),
  defines("define-hidden", `{ value: "hidden", writable: true, enumerable: false, configurable: true }`),
  defines("define-permanent", `{ value: "permanent", writable: true, enumerable: true, configurable: false }`),
  defines("define-value-alone", `{ value: "bare" }`),
  defines("define-nothing", `{}`),
  defines("define-same-number", `{ value: 2 }`),
  defines("switch-off-writable", `{ writable: false }`),
  defines("switch-off-enumerable", `{ enumerable: false }`),
  defines("switch-off-configurable", `{ configurable: false }`),
  defines("switch-off-one-by-one", `{ writable: false }`, `{ enumerable: false }`, `{ configurable: false }`),
  defines("define-accessor", `{ ${accessor}, enumerable: true, configurable: true }`),
  defines("define-getter", `{ get() { note("get"); return "got"; }, enumerable: true, configurable: true }`),
  defines("define-setter", `{ set(v) { note("set " + str(v)); }, enumerable: true, configurable: true }`),
  defines("define-hidden-accessor", `{ ${accessor}, enumerable: false, configurable: true }`),
  defines("define-permanent-accessor", `{ ${accessor}, enumerable: true, configurable: false }`),
  defines("define-accessor-that-throws", `{ get() { note("get"); throw new RangeError("get"); }, set(v) { note("set"); throw new RangeError("set"); }, enumerable: true, configurable: true }`),
  defines("accessor-then-data", `{ ${accessor}, enumerable: true, configurable: true }`, `{ value: "data", writable: true }`),
  defines("data-then-accessor", `{ value: "data", writable: true, enumerable: true, configurable: true }`, `{ ${accessor} }`),
  defines("read-only-then-writable", `{ value: "read-only", writable: false, enumerable: true, configurable: true }`, `{ writable: true }`),
  defines("read-only-then-other-value", `{ value: "read-only", writable: false, enumerable: true, configurable: true }`, `{ value: "replaced" }`),
  defines("locked-then-other-value", `{ value: "locked", writable: false, enumerable: true, configurable: false }`, `{ value: "replaced" }`),
  defines("locked-then-same-value", `{ value: "locked", writable: false, enumerable: true, configurable: false }`, `{ value: "locked" }`),
  defines("permanent-then-accessor", `{ value: "permanent", writable: true, enumerable: true, configurable: false }`, `{ ${accessor} }`),
  defines("permanent-then-read-only", `{ value: "permanent", writable: true, enumerable: true, configurable: false }`, `{ writable: false }`),
  defines("permanent-then-hidden", `{ value: "permanent", writable: true, enumerable: true, configurable: false }`, `{ enumerable: false }`),
  { name: "reflect-define", text: s => `note("defined " + Reflect.defineProperty(${s.object}, ${s.key}, { value: "reflected", writable: false, enumerable: true, configurable: false }));\nnote("again " + Reflect.defineProperty(${s.object}, ${s.key}, { value: "other" }));\n` },
  { name: "define-properties", text: s => `Object.defineProperties(${s.object}, { extra: { value: 1, enumerable: true }, ${s.inLiteral}: { ${accessor}, enumerable: true, configurable: true } });\n` },
  { name: "define-getter-by-legacy-method", text: s => `Object.prototype.__defineGetter__.call(${s.object}, ${s.key}, function () { note("get"); return "got"; });\n` },
  { name: "define-setter-by-legacy-method", text: s => `Object.prototype.__defineSetter__.call(${s.object}, ${s.key}, function (v) { note("set " + str(v)); });\n` },
  // The descriptor is not a literal at the call.
  { name: "define-copied-descriptor", text: s => `const source = { get ${s.inLiteral}() { note("get"); return "got"; }, set ${s.inLiteral}(v) { note("set " + str(v)); } };\nObject.defineProperty(${s.object}, ${s.key}, Object.getOwnPropertyDescriptor(source, ${s.key}));\n` },
  { name: "define-copied-data-descriptor", text: s => `const source = { ${s.inLiteral}: "copied" };\nObject.defineProperty(${s.object}, ${s.key}, Object.getOwnPropertyDescriptor(source, ${s.key}));\n` },
  { name: "define-copied-descriptors", text: s => `Object.defineProperties(${s.object}, Object.getOwnPropertyDescriptors({ early: 1, get ${s.inLiteral}() { note("get"); return "got"; } }));\n` },
  { name: "define-inherited-descriptor", text: s => `Object.defineProperty(${s.object}, ${s.key}, Object.create({ value: "inherited descriptor", writable: false, enumerable: true, configurable: true }));\n` },
  { name: "define-inherited-accessor-descriptor", text: s => `Object.defineProperty(${s.object}, ${s.key}, Object.create({ ${accessor}, enumerable: true, configurable: true }));\n` },
  { name: "define-descriptor-with-getters", text: s => `Object.defineProperty(${s.object}, ${s.key}, { get value() { note("descriptor value"); return "from getter"; }, get writable() { note("descriptor writable"); return false; }, enumerable: true, configurable: true });\n` },
  { name: "define-descriptor-instance", text: s => `class Descriptor {\nvalue = "instance";\nwritable = false;\nenumerable = true;\nconfigurable = true;\n}\nObject.defineProperty(${s.object}, ${s.key}, new Descriptor());\n` },
  { name: "define-descriptor-filled-later", text: s => `const descriptor = {};\ndescriptor.get = function () { note("get"); return "got"; };\ndescriptor.configurable = true;\ndescriptor.enumerable = true;\nObject.defineProperty(${s.object}, ${s.key}, descriptor);\n` },
  { name: "define-descriptor-from-helper", before: () => `function readOnly(value) { return { value, writable: false, enumerable: true, configurable: true }; }\n`, text: s => `Object.defineProperty(${s.object}, ${s.key}, readOnly("from helper"));\n` },
  { name: "define-descriptor-picked", text: s => `Object.defineProperty(${s.object}, ${s.key}, count >= 0 ? { ${accessor}, enumerable: true, configurable: true } : { value: 2, writable: true, enumerable: true, configurable: true });\n` },
  { name: "define-descriptor-proxy", text: s => `Object.defineProperty(${s.object}, ${s.key}, new Proxy({ value: "behind proxy", writable: false, enumerable: true, configurable: true }, {}));\n` },
  { name: "define-descriptor-function", text: s => `const descriptor = function () {};\ndescriptor.value = "on a function";\ndescriptor.enumerable = true;\ndescriptor.configurable = true;\nObject.defineProperty(${s.object}, ${s.key}, descriptor);\n` },
  { name: "define-field", before: s => stamp(`${s.inLiteral} = "field";`), text: s => `new Stamp(${s.object});\n` },
  { name: "define-private-field", before: () => stamp(`#secret = 1;\n  static has(given) { return #secret in given; }`), text: s => `new Stamp(${s.object});\nnote("stamped " + Stamp.has(${s.object}));\n` },

  { name: "delete", text: s => `note("deleted " + delete ${s.at(s.object)});\n` },
  { name: "delete-twice", text: s => `note("deleted " + delete ${s.at(s.object)});\nnote("deleted " + delete ${s.at(s.object)});\n` },
  { name: "delete-and-store", text: s => `delete ${s.at(s.object)};\n${s.at(s.object)} = "again";\n` },
  { name: "delete-and-store-number", text: s => `delete ${s.at(s.object)};\n${s.at(s.object)} = 9;\n` },
  { name: "delete-first", text: s => `note("deleted " + delete ${s.object}.a);\n` },
  { name: "delete-last", text: s => `note("deleted " + delete ${s.object}.z);\n` },
  { name: "delete-first-and-store", text: s => `delete ${s.object}.a;\n${s.object}.a = "again";\n` },
  { name: "delete-all", text: s => `delete ${s.object}.a;\ndelete ${s.at(s.object)};\ndelete ${s.object}.z;\n` },
  { name: "delete-method", text: s => `note("deleted " + delete ${s.object}.m);\n` },
  { name: "reflect-delete", text: s => `note("deleted " + Reflect.deleteProperty(${s.object}, ${s.key}));\n` },
  { name: "permanent-then-delete", text: s => `Object.defineProperty(${s.object}, ${s.key}, { value: "permanent", writable: true, enumerable: true, configurable: false });\nnote("deleted " + delete ${s.at(s.object)});\n` },

  { name: "freeze", text: s => `Object.freeze(${s.object});\n` },
  { name: "seal", text: s => `Object.seal(${s.object});\n` },
  { name: "prevent-extensions", text: s => `Object.preventExtensions(${s.object});\n` },
  { name: "reflect-prevent-extensions", text: s => `note("prevented " + Reflect.preventExtensions(${s.object}));\n` },
  { name: "accessor-then-freeze", text: s => `Object.defineProperty(${s.object}, ${s.key}, { ${accessor}, enumerable: true, configurable: true });\nObject.freeze(${s.object});\n` },
  { name: "delete-then-seal", text: s => `delete ${s.at(s.object)};\nObject.seal(${s.object});\n` },

  setsPrototype("prototype-to-null", () => `null`),
  setsPrototype("prototype-to-empty", () => `{}`),
  setsPrototype("prototype-to-data", s => `{ ${s.inLiteral}: "inherited", m() { return "other m"; } }`),
  setsPrototype("prototype-to-accessor", s => `{ get ${s.inLiteral}() { note("get above"); return "got above"; }, set ${s.inLiteral}(v) { note("set above " + str(v)); } }`),
  setsPrototype("prototype-to-getter", s => `{ get ${s.inLiteral}() { note("get above"); return "got above"; } }`),
  setsPrototype("prototype-to-read-only", s => `Object.freeze({ ${s.inLiteral}: "frozen above" })`),
  setsPrototype("prototype-to-proxy", () => proxyAbove),
  setsPrototype("prototype-to-index-accessors", () => `{ get 0() { note("get 0 above"); return "zero above"; }, set 0(v) { note("set 0 above"); }, get 1() { note("get 1 above"); return "one above"; }, set 1(v) { note("set 1 above"); }, get 7() { note("get 7 above"); return "seven above"; }, set 7(v) { note("set 7 above"); } }`),
  setsPrototype("prototype-to-array", () => `[1, 2, 3, 4, 5, 6, 7, 8]`),
  setsPrototype("prototype-to-function", () => `function above() {}`),
  setsPrototype("prototype-to-its-heir", s => `Object.create(${s.object})`),
  setsPrototype("prototype-to-the-same", s => `Object.getPrototypeOf(${s.object})`),
  { name: "prototype-by-proto-store", text: s => `${s.object}.__proto__ = { ${s.inLiteral}: "inherited", m() { return "other m"; } };\n` },
  { name: "prototype-by-proto-store-of-null", text: s => `${s.object}.__proto__ = null;\n` },
  { name: "prototype-by-proto-store-of-number", text: s => `${s.object}.__proto__ = 5;\n` },
  { name: "prototype-by-reflect", text: s => `note("set " + Reflect.setPrototypeOf(${s.object}, { set ${s.inLiteral}(v) { note("set above " + str(v)); } }));\n` },
  { name: "prototype-away-and-back", text: s => `const kept = Object.getPrototypeOf(${s.object});\nObject.setPrototypeOf(${s.object}, null);\nObject.setPrototypeOf(${s.object}, kept);\n` },

  adds(1),
  adds(7),
  adds(65),
  adds(1025),
  { name: "add-and-remove-65", text: s => `for (let i = 0; i < 65; i++) ${s.object}["p" + i] = i;\nfor (let i = 0; i < 65; i++) delete ${s.object}["p" + i];\n` },
  { name: "add-index-and-symbol", text: s => `${s.object}.late = 1;\n${s.object}[Symbol.for("late")] = 2;\n${s.object}[3] = 3;\n${s.object}["-2"] = 4;\n` },
  stores("store-number", `9`),
  stores("store-double", `9.5`),
  stores("store-text", `"stored"`),
  stores("store-undefined", `undefined`),
  stores("store-null", `null`),
  stores("store-object", `{ inner: 1 }`),
  stores("store-function", `function () { return "stored function"; }`),
  stores("store-big-integer", `9n`),
  stores("store-another-instance", `make()`),
  { name: "increment", text: s => `${s.at(s.object)}++;\n` },
  { name: "add-to-it", text: s => `${s.at(s.object)} += "more";\n`, refusesCalledKey: true },
  { name: "store-if-missing", text: s => `${s.at(s.object)} ??= "filled";\n` },
  { name: "store-if-present", text: s => `${s.at(s.object)} &&= "replaced";\n` },
  { name: "assign", text: s => `Object.assign(${s.object}, { early: 1, ${s.inLiteral}: "assigned", late: 2 });\n` },
  { name: "assign-from-getter", text: s => `Object.assign(${s.object}, { get ${s.inLiteral}() { note("source get"); return "from getter"; } });\n` },
  { name: "assign-source-changes-target", text: s => `Object.assign(${s.object}, { get early() { note("deleted " + delete ${s.at(s.object)}); return 1; }, ${s.inLiteral}: "assigned" });\n` },
  { name: "assign-instance-of-the-same-kind", text: s => `Object.assign(${s.object}, make());\n` },
  { name: "assign-two-sources", text: s => `Object.assign(${s.object}, { ${s.inLiteral}: "first" }, null, { ${s.inLiteral}: "second", late: 2 });\n` },
  { name: "assign-text", text: s => `Object.assign(${s.object}, "xy");\n` },
  { name: "assign-array", text: s => `Object.assign(${s.object}, ["x", "y"]);\n` },
  { name: "assign-proxy", text: s => `Object.assign(${s.object}, new Proxy({ ${s.inLiteral}: "behind proxy" }, {}));\n` },
  // The loops with which programs copy members from one object to another.
  { name: "copy-by-keys-loop", text: s => `const source = { early: 1, ${s.inLiteral}: "copied", late: 2 };\nconst keys = Object.keys(source);\nfor (let i = 0; i < keys.length; i++) ${s.object}[keys[i]] = source[keys[i]];\n` },
  { name: "copy-by-for-in", text: s => `const source = { early: 1, ${s.inLiteral}: "copied", late: 2 };\nfor (const key in source) ${s.object}[key] = source[key];\n` },
  { name: "copy-by-entries", text: s => `const changed = ${s.object};\nObject.entries({ early: 1, ${s.inLiteral}: "copied", late: 2 }).forEach(([key, value]) => { changed[key] = value; });\n`, usesLibrary: true },
  { name: "copy-descriptors-by-own-keys", text: s => `const source = { early: 1, get ${s.inLiteral}() { note("get"); return "got"; } };\nfor (const key of Reflect.ownKeys(source)) Object.defineProperty(${s.object}, key, Object.getOwnPropertyDescriptor(source, key));\n` },
  { name: "copy-methods-of-a-class", text: s => `class Mixed {\n${s.inLiteral}() { return "mixed in"; }\nm() { return "mixed m"; }\n}\nfor (const key of Object.getOwnPropertyNames(Mixed.prototype)) if (key !== "constructor") ${s.object}[key] = Mixed.prototype[key];\n` },
  { name: "reflect-set", text: s => `note("set " + Reflect.set(${s.object}, ${s.key}, "reflected"));\n` },
  { name: "reflect-set-for-another-receiver", text: s => `const receiver = {};\nnote("set " + Reflect.set(${s.object}, ${s.key}, "reflected", receiver));\nnote("receiver has " + Reflect.ownKeys(receiver).length);\n` },
  { name: "reflect-set-as-receiver", text: s => `note("set " + Reflect.set({}, ${s.key}, "reflected", ${s.object}));\n` },
  { name: "reflect-set-as-receiver-of-setter", text: s => `const changed = ${s.object};\nnote("set " + Reflect.set({ set ${s.inLiteral}(v) { note("setter for the object " + (this === changed)); } }, ${s.key}, "reflected", changed));\n` },
  { name: "reflect-set-for-a-number", text: s => `note("set " + Reflect.set(${s.object}, ${s.key}, "reflected", 5));\n` },
  { name: "super-store", before: s => `const storer = { __proto__: {}, put(v) { super${s.at("")} = v; } };\n`, text: s => `storer.put.call(${s.object}, "through super");\n` },
  { name: "super-store-meets-setter", before: s => `const storer = { __proto__: { set ${s.inLiteral}(v) { note("set of super " + str(v)); } }, put(v) { super${s.at("")} = v; } };\n`, text: s => `storer.put.call(${s.object}, "through super");\n` },

  { name: "length-to-zero", text: s => `${s.object}.length = 0;\n`, needsArrayLike: true },
  { name: "length-shrinks", text: s => `${s.object}.length = 1;\n`, needsArrayLike: true },
  { name: "length-grows", text: s => `${s.object}.length = 9;\n`, needsArrayLike: true },
  { name: "length-grows-far", text: s => `${s.object}.length = 100000;\n`, needsArrayLike: true },
  { name: "length-from-object", text: s => `${s.object}.length = { valueOf() { note("length valueOf"); return 2; } };\n`, needsArrayLike: true },
  { name: "length-invalid", text: s => `${s.object}.length = -1;\n`, needsArrayLike: true },
  { name: "length-read-only", text: s => `Object.defineProperty(${s.object}, "length", { writable: false });\n`, needsArrayLike: true },
  { name: "length-read-only-and-shorter", text: s => `Object.defineProperty(${s.object}, "length", { value: 1, writable: false });\n`, needsArrayLike: true },
  { name: "length-shrinks-past-permanent-element", text: s => `Object.defineProperty(${s.object}, 1, { value: "permanent", writable: true, enumerable: true, configurable: false });\n${s.object}.length = 0;\n`, needsArrayLike: true },
  { name: "make-hole", text: s => `delete ${s.object}[1];\n`, needsArrayLike: true },
  { name: "make-hole-at-the-end", text: s => `delete ${s.object}[2];\n`, needsArrayLike: true },
  { name: "store-past-the-end", text: s => `${s.object}[5] = "far";\n`, needsArrayLike: true },
  { name: "store-far-past-the-end", text: s => `${s.object}[100000] = "far";\n`, needsArrayLike: true },
  { name: "element-of-another-kind", text: s => `${s.object}[1] = "text";\n`, needsArrayLike: true },
  { name: "element-double", text: s => `${s.object}[1] = 0.5;\n`, needsArrayLike: true },
  { name: "element-accessor", text: s => `Object.defineProperty(${s.object}, 1, { get() { note("get 1"); return "got 1"; }, set(v) { note("set 1 " + str(v)); }, enumerable: true, configurable: true });\n`, needsArrayLike: true },
  { name: "element-read-only", text: s => `Object.defineProperty(${s.object}, 1, { value: "read-only", writable: false, enumerable: true, configurable: true });\n`, needsArrayLike: true },
  { name: "element-hidden", text: s => `Object.defineProperty(${s.object}, 1, { enumerable: false });\n`, needsArrayLike: true },
  onArray("push", "push", `40`),
  onArray("pop", "pop"),
  onArray("shift", "shift"),
  onArray("unshift", "unshift", `5`),
  onArray("splice", "splice", `1, 1`),
  onArray("splice-in", "splice", `1, 0, "in", "two"`),
  onArray("reverse", "reverse"),
  onArray("fill", "fill", `0`),
  onArray("copy-within", "copyWithin", `0, 1`),
  { ...onArray("sort", "sort", `(p, q) => q - p`), usesLibrary: true },
];

interface Look {
  name: string;
  /** Statements that leave what they saw in `seen`. */
  text: (site: Site) => string;
  before?: (site: Site) => string;
  helpers?: string[];
  needsArrayLike?: boolean;
  needsClass?: boolean;
  needsCalledKey?: boolean;
  /** It would print the source text of a function. */
  refusesCallable?: boolean;
  needsHost?: boolean;
  needsCallable?: boolean;
  readsNameOfBoundFunction?: boolean;
  usesLibrary?: boolean;
}

const looks: Look[] = [
  // Looks that read.
  { name: "read", text: s => `seen = str(${s.at(s.object)});\n` },
  { name: "read-twice", text: s => `seen = str(${s.at(s.object)}) + " " + str(${s.at(s.object)});\n` },
  { name: "read-if-there", text: s => `seen = str(${s.object}?.${s.at("").replace(/^\./, "")});\n` },
  { name: "type-of", text: s => `seen = typeof ${s.at(s.object)};\n` },
  { name: "call", text: s => `seen = str(${s.at(s.object)}(note));\n`, needsCalledKey: true },
  { name: "call-method", text: s => `seen = str(${s.object}.m());\n` },
  // A function is read from the literal or the class that it was written in once more.
  { name: "same-when-read-again", text: s => `let same = 0;\nfor (let i = 0; i < hosts.length; i++) if (hosts[i].made === ${s.object} && hosts[i].made === hosts[i].made) same++;\nseen = str(same);\n`, needsHost: true },
  { name: "read-through-its-host", text: s => `let found = "";\nfor (let i = 0; i < hosts.length; i++) found += str(${s.at("hosts[i].made")}) + " ";\nseen = found;\n`, needsHost: true },
  { name: "store-through-its-host", text: s => `for (let i = 0; i < hosts.length; i++) ${s.at("hosts[i].made")} = i;\nseen = str(${s.at(s.object)});\n`, needsHost: true },
  {
    name: "same-by-every-way-of-reading",
    text: s =>
      `let found = "no host";\nfor (let i = 0; i < hosts.length; i++) {\nconst host = hosts[i];\nif (host.made !== ${s.object}) continue;\nconst descriptor = Object.getOwnPropertyDescriptor(host, "made");\nconst { made } = host;\nfound = [descriptor && "value" in descriptor ? descriptor.value : made, made, Reflect.get(host, "made"), host["made!".slice(0, 4)], { ...host }.made ?? made, Object.assign({}, host).made ?? made, Object.values(host).find(value => typeof value === "function") ?? made, Object.entries(host).find(([key]) => key === "made")?.[1] ?? made].map(value => value === ${s.object}).join();\n}\nseen = found;\n`,
    needsHost: true,
    usesLibrary: true,
  },
  { name: "call-it", text: s => `seen = typeof ${s.object}(1, 2);\n`, needsCallable: true },
  { name: "call-it-with-call", text: s => `seen = typeof ${s.object}.call({ beside: 2 }, 1, 2);\n`, needsCallable: true, usesLibrary: true },
  { name: "construct-it", text: s => `seen = typeof new ${s.object}(1, 2);\n`, needsCallable: true },
  { name: "bind-it", text: s => `const bound = ${s.object}.bind(null, 1);\nseen = str(bound.name) + " " + str(bound.length) + " " + str(Object.hasOwn(bound, "prototype"));\n`, needsCallable: true, readsNameOfBoundFunction: true, usesLibrary: true },
  { name: "name-and-length", text: s => `seen = str(${s.object}.name) + " " + str(${s.object}.length) + " " + typeof ${s.object}.prototype;\n`, needsCallable: true },
  { name: "as-a-key", text: s => `const table = new WeakMap();\ntable.set(${s.object}, "kept");\nseen = str(table.get(${s.object})) + " " + str(new Set([${s.object}, ${s.object}]).size);\n`, needsCallable: true, usesLibrary: true },
  { name: "in", text: s => `seen = str(${s.key} in ${s.object});\n` },
  { name: "has-own", text: s => `seen = str(Object.hasOwn(${s.object}, ${s.key}));\n` },
  { name: "has-own-property", text: s => `seen = str(Object.prototype.hasOwnProperty.call(${s.object}, ${s.key}));\n` },
  { name: "is-enumerable", text: s => `seen = str(Object.prototype.propertyIsEnumerable.call(${s.object}, ${s.key}));\n` },
  { name: "reflect-get", text: s => `seen = str(Reflect.get(${s.object}, ${s.key}));\n` },
  { name: "reflect-get-for-another-receiver", text: s => `seen = str(Reflect.get(${s.object}, ${s.key}, { other: true }));\n` },
  { name: "reflect-has", text: s => `seen = str(Reflect.has(${s.object}, ${s.key}));\n` },
  { name: "keys", text: s => `seen = listed(Object.keys(${s.object}));\n`, helpers: ["listed"] },
  { name: "names", text: s => `seen = listed(Object.getOwnPropertyNames(${s.object}));\n`, helpers: ["listed"] },
  { name: "symbols", text: s => `seen = listed(Object.getOwnPropertySymbols(${s.object}));\n`, helpers: ["listed"] },
  { name: "own-keys", text: s => `seen = listed(Reflect.ownKeys(${s.object}));\n`, helpers: ["listed"] },
  { name: "for-in", text: s => `const found = [];\nfor (const key in ${s.object}) found.push(key);\nseen = listed(found);\n`, helpers: ["listed"] },
  { name: "for-in-with-values", text: s => `const found = [];\nfor (const key in ${s.object}) found.push(key + "=" + str(${s.object}[key]));\nseen = listed(found);\n`, helpers: ["listed"] },
  { name: "json", text: s => `seen = shortened(str(JSON.stringify(${s.object})));\n`, helpers: ["listed"] },
  { name: "spread", text: s => `seen = contents({ ...${s.object} });\n`, helpers: ["listed", "contents"] },
  { name: "rest", text: s => `const { a, ...rest } = ${s.object};\nseen = str(a) + " " + contents(rest);\n`, helpers: ["listed", "contents"] },
  { name: "rest-without-the-key", text: s => `const { ${s.inLiteral}: taken, ...rest } = ${s.object};\nseen = str(taken) + " " + contents(rest);\n`, helpers: ["listed", "contents"] },
  { name: "assigned-copy", text: s => `seen = contents(Object.assign({}, ${s.object}));\n`, helpers: ["listed", "contents"] },
  { name: "entries", text: s => `seen = listed(Object.entries(${s.object}).map(([key, value]) => key + "=" + str(value)));\n`, helpers: ["listed"], usesLibrary: true },
  { name: "values", text: s => `seen = listed(Object.values(${s.object}).map(str));\n`, helpers: ["listed"], usesLibrary: true },
  { name: "destructure", text: s => `const { ${s.inLiteral}: taken = "default" } = ${s.object};\nseen = str(taken);\n` },
  { name: "instance-of", text: s => `seen = str(${s.object} instanceof ${s.holder.class});\n`, needsClass: true },
  { name: "is-prototype-of", text: s => `seen = str(${s.holder.class}.prototype.isPrototypeOf(${s.object}));\n`, needsClass: true },
  { name: "descriptor", text: s => `seen = described(Object.getOwnPropertyDescriptor(${s.object}, ${s.key}));\n`, helpers: ["described"] },
  { name: "reflect-descriptor", text: s => `seen = described(Reflect.getOwnPropertyDescriptor(${s.object}, ${s.key}));\n`, helpers: ["described"] },
  {
    name: "descriptors",
    text: s => `const all = Object.getOwnPropertyDescriptors(${s.object});\nconst found = [];\nfor (const key of Reflect.ownKeys(all)) if (!saysWhereItWasMade(key)) found.push(String(key) + ": " + described(all[key]));\nseen = listed(found);\n`,
    helpers: ["listed", "described"],
  },
  { name: "integrity", text: s => `seen = Object.isFrozen(${s.object}) + " " + Object.isSealed(${s.object}) + " " + Object.isExtensible(${s.object});\n` },
  { name: "prototype-chain", text: s => `let depth = 0;\nfor (let above = Object.getPrototypeOf(${s.object}); above !== null && depth < 9; above = Object.getPrototypeOf(above)) depth++;\nseen = str(depth);\n` },
  { name: "proto-read", text: s => `seen = str(${s.object}.__proto__ === Object.getPrototypeOf(${s.object}));\n` },
  { name: "neighbors", text: s => `seen = str(${s.object}.a) + " " + str(${s.object}.z);\n` },
  { name: "to-text", text: s => `seen = str("" + ${s.object});\n`, refusesCallable: true },
  { name: "to-number", text: s => `seen = str(+${s.object});\n`, refusesCallable: true },
  { name: "in-template", text: s => `seen = str(\`\${${s.object}}\`);\n`, refusesCallable: true },
  { name: "tag", text: s => `seen = Object.prototype.toString.call(${s.object});\n` },
  { name: "loosely-equal", text: s => `seen = str(${s.object} == 7) + " " + str(${s.object} == "text");\n`, refusesCallable: true },
  { name: "constructor-name", text: s => `seen = str(${s.object}.constructor && ${s.object}.constructor.name);\n` },
  { name: "length", text: s => `seen = str(${s.object}.length);\n`, needsArrayLike: true },
  { name: "elements", text: s => `const found = [];\nfor (let i = 0; i < ${s.object}.length && i < 12; i++) found.push(str(${s.object}[i]));\nseen = listed(found);\n`, helpers: ["listed"], needsArrayLike: true },
  { name: "elements-present", text: s => `const found = [];\nfor (let i = 0; i < ${s.object}.length && i < 12; i++) found.push(str(i in ${s.object}));\nseen = listed(found);\n`, helpers: ["listed"], needsArrayLike: true },
  { name: "iterate", text: s => `const found = [];\nfor (const element of ${s.object}) { found.push(str(element)); if (found.length > 11) break; }\nseen = listed(found);\n`, helpers: ["listed"] },
  { name: "spread-elements", text: s => `seen = shortened(str(JSON.stringify([...${s.object}])));\n`, helpers: ["listed"] },
  { name: "destructure-elements", text: s => `const [first, second = "default", ...others] = ${s.object};\nseen = str(first) + " " + str(second) + " " + others.length;\n` },
  { name: "join", text: s => `seen = shortened(${s.arrayCall("join")});\n`, helpers: ["listed"], needsArrayLike: true },
  { name: "index-of", text: s => `seen = str(${s.arrayCall("indexOf", "30")}) + " " + str(${s.arrayCall("includes", "undefined")}) + " " + str(${s.arrayCall("lastIndexOf", "10")});\n`, needsArrayLike: true },
  { name: "slice", text: s => `seen = shortened(str(JSON.stringify(${s.arrayCall("slice", "0, 12")})));\n`, helpers: ["listed"], needsArrayLike: true },
  { name: "concat", text: s => `seen = shortened(str(JSON.stringify([0].concat(${s.object}).length)));\n`, helpers: ["listed"] },
  { name: "at-the-end", text: s => `seen = str(${s.arrayCall("at", "-1")});\n`, needsArrayLike: true },
  { name: "is-array", text: s => `seen = str(Array.isArray(${s.object}));\n` },
  { name: "visited-by-for-each", text: s => `const found = [];\n${s.arrayCall("forEach", `(element, i) => { if (i < 12) found.push(i + "=" + str(element)); }`)};\nseen = listed(found);\n`, helpers: ["listed"], needsArrayLike: true, usesLibrary: true },
  { name: "mapped", text: s => `seen = shortened(str(JSON.stringify(${s.arrayCall("map", `element => str(element)`)})));\n`, helpers: ["listed"], needsArrayLike: true, usesLibrary: true },

  // Looks that read nothing: only an effect tells.
  { name: "store", text: s => `${s.at(s.object)} = 5;\nseen = "stored";\n` },
  { name: "store-text", text: s => `${s.at(s.object)} = "five";\nseen = "stored";\n` },
  { name: "store-undefined", text: s => `${s.at(s.object)} = undefined;\nseen = "stored";\n` },
  { name: "store-twice", text: s => `${s.at(s.object)} = 5;\n${s.at(s.object)} = 6;\nseen = "stored";\n` },
  { name: "store-and-count", text: s => `${s.at(s.object)} = 5;\nseen = "stored, has " + Reflect.ownKeys(${s.object}).length;\n` },
  { name: "store-neighbor", text: s => `${s.object}.z = 5;\nseen = "stored";\n` },
  { name: "store-fresh-name", text: s => `${s.object}.fresh = 5;\nseen = "stored";\n` },
  { name: "store-under-converted-key", text: s => `${s.object}[{ [Symbol.toPrimitive]() { note("key"); return ${s.key}; } }] = (note("value"), 5);\nseen = "stored";\n` },
  { name: "store-through-heir", text: s => `const heir = Object.create(${s.object});\n${s.at("heir")} = 5;\nseen = "stored, heir has " + Reflect.ownKeys(heir).length;\n` },
  { name: "store-through-heir-unseen", text: s => `const heir = Object.create(${s.object});\n${s.at("heir")} = 5;\nseen = "stored";\n` },
  { name: "store-through-super", before: s => `const viaSuper = { put(v) { super${s.at("")} = v; } };\n`, text: s => `Object.setPrototypeOf(viaSuper, ${s.object});\nviaSuper.put(5);\nseen = "stored, has " + Reflect.ownKeys(viaSuper).length;\n` },
  { name: "delete", text: s => `seen = "deleted " + delete ${s.at(s.object)};\n` },
  { name: "delete-and-count", text: s => `seen = "deleted " + delete ${s.at(s.object)} + ", has " + Reflect.ownKeys(${s.object}).length;\n` },
  { name: "delete-then-store", text: s => `delete ${s.at(s.object)};\n${s.at(s.object)} = 5;\nseen = "stored";\n` },
  { name: "store-then-delete", text: s => `${s.at(s.object)} = 5;\nseen = "deleted " + delete ${s.at(s.object)};\n` },
  { name: "delete-neighbor", text: s => `seen = "deleted " + delete ${s.object}.a;\n` },
  { name: "reflect-set", text: s => `seen = "set " + Reflect.set(${s.object}, ${s.key}, 5);\n` },
  { name: "reflect-set-as-receiver", text: s => `seen = "set " + Reflect.set({}, ${s.key}, 5, ${s.object});\n` },
  { name: "reflect-define", text: s => `seen = "defined " + Reflect.defineProperty(${s.object}, ${s.key}, { value: 5 });\n` },
  { name: "reflect-define-accessor", text: s => `seen = "defined " + Reflect.defineProperty(${s.object}, ${s.key}, { get() { return 5; } });\n` },
  { name: "reflect-delete", text: s => `seen = "deleted " + Reflect.deleteProperty(${s.object}, ${s.key});\n` },
  { name: "define", text: s => `Object.defineProperty(${s.object}, ${s.key}, { value: 5, writable: true, enumerable: true, configurable: true });\nseen = "defined";\n` },
  { name: "define-field", before: s => `class Definer extends function (given) { return given; } {\n  ${s.inLiteral} = 5;\n}\n`, text: s => `new Definer(${s.object});\nseen = "defined";\n` },
  { name: "assign-onto", text: s => `Object.assign(${s.object}, { ${s.inLiteral}: 5 });\nseen = "assigned";\n` },
  { name: "read-unused", text: s => `${s.at(s.object)};\nseen = "read";\n` },
  { name: "in-unused", text: s => `${s.key} in ${s.object};\nseen = "asked";\n` },
  { name: "copy-unused", text: s => `({ ...${s.object} });\nseen = "copied";\n` },
  { name: "keys-unused", text: s => `Object.keys(${s.object});\nseen = "listed";\n` },
  { name: "json-unused", text: s => `JSON.stringify(${s.object});\nseen = "written";\n` },
  { name: "for-in-unused", text: s => `let rounds = 0;\nfor (const key in ${s.object}) rounds++;\nseen = "rounds " + rounds;\n` },
  { name: "resolve", text: s => `Promise.resolve(${s.object});\nseen = "resolved";\n` },
  { name: "make-another", text: () => `make();\nseen = "made";\n` },
  { name: "freeze", text: s => `Object.freeze(${s.object});\nseen = "frozen";\n` },
  { name: "seal", text: s => `Object.seal(${s.object});\nseen = "sealed";\n` },
  { name: "prevent-extensions", text: s => `seen = "prevented " + Reflect.preventExtensions(${s.object});\n` },
  { name: "set-prototype", text: s => `seen = "set " + Reflect.setPrototypeOf(${s.object}, null);\n` },
  { name: "set-same-prototype", text: s => `Object.setPrototypeOf(${s.object}, Object.getPrototypeOf(${s.object}));\nseen = "set";\n` },
  { name: "store-proto", text: s => `${s.object}.__proto__ = {};\nseen = "stored";\n` },
  { name: "push", text: s => `seen = "pushed " + ${s.arrayCall("push", "40")};\n`, needsArrayLike: true },
  { name: "pop", text: s => `${s.arrayCall("pop")};\nseen = "popped";\n`, needsArrayLike: true },
  { name: "store-element", text: s => `${s.object}[1] = 5;\nseen = "stored";\n`, needsArrayLike: true },
  { name: "store-at-length", text: s => `${s.object}[${s.object}.length] = 5;\nseen = "stored";\n`, needsArrayLike: true },
  { name: "store-converted-element", text: s => `${s.object}[1] = { valueOf() { note("valueOf"); return 5; } };\nseen = "stored";\n`, needsArrayLike: true },
  { name: "store-length", text: s => `${s.object}.length = 2;\nseen = "stored";\n`, needsArrayLike: true },
];

interface Parts {
  make: string;
  /** What is changed, given the variable that holds the object. */
  subject: (object: string) => string;
  /** The change of the given object. An exception is noted. */
  change: (subject: string) => string;
  /** Leaves what a look at the object saw, with the effects it had, in `line`. */
  observe: (object: string) => string;
  /** Looks and prints. `label` is an expression. */
  look: (object: string, label: string) => string;
}

interface Place {
  name: string;
  text: (parts: Parts) => string;
  /** The change runs before there is an object. */
  needsOtherTarget?: boolean;
  needsArrayLike?: boolean;
  usesLibrary?: boolean;
}

const locals = `let seen, before, line;\n`;
const reportFailure = `print("run threw " + e.name);\n`;
const inFunction = (body: string, keyword = "function") =>
  `${keyword} run() {\n${locals}${body}}\n${keyword === "function" ? `try {\nrun();\n} catch (e) {\n${reportFailure}}\n` : `run().then(undefined, e => {\n${reportFailure}});\n`}`;
const around = (p: Parts, between: string, setup = "") => `const o = ${p.make};\n${setup}${p.look("o", `"before"`)}${between}${p.look("o", `"after"`)}`;

/** Something that runs statements once, which name `o`. */
interface Trigger {
  name: string;
  text: (body: string) => string;
  isAsync?: boolean;
  usesLibrary?: boolean;
}

const once = (body: string) => `if (!isDone) {\nisDone = true;\n${body}}\n`;
const triggers: Trigger[] = [
  { name: "in-closure", text: body => `const later = () => {\n${body}};\nlater();\n` },
  { name: "in-for-each", text: body => `[0].forEach(() => {\n${body}});\n`, usesLibrary: true },
  { name: "in-map", text: body => `[0].map(() => {\n${body}});\n`, usesLibrary: true },
  { name: "in-find", text: body => `[0].find(() => {\n${body}});\n`, usesLibrary: true },
  { name: "in-reduce", text: body => `[0, 1].reduce(() => {\n${body}});\n`, usesLibrary: true },
  { name: "in-array-from", text: body => `Array.from({ length: 1 }, () => {\n${body}});\n`, usesLibrary: true },
  { name: "in-sort", text: body => `let isDone = false;\n[2, 1].sort((p, q) => {\n${once(body)}return p - q;\n});\n`, usesLibrary: true },
  { name: "in-replace", text: body => `"x".replace("x", () => {\n${body}return "y";\n});\n`, usesLibrary: true },
  { name: "in-replace-by-pattern", text: body => `"x".replace(/x/, () => {\n${body}return "y";\n});\n`, usesLibrary: true },
  { name: "in-reviver", text: body => `JSON.parse("1", (key, value) => {\n${body}return value;\n});\n` },
  { name: "in-replacer", text: body => `JSON.stringify(1, (key, value) => {\n${body}return value;\n});\n` },
  { name: "in-to-json", text: body => `JSON.stringify({ toJSON() {\n${body}return 1;\n} });\n` },
  { name: "in-getter-run-by-assign", text: body => `Object.assign({}, { get trigger() {\n${body}return 1;\n} });\n` },
  { name: "in-getter-run-by-spread", text: body => `({ ...{ get trigger() {\n${body}return 1;\n} } });\n` },
  { name: "in-getter", text: body => `const trigger = { get fire() {\n${body}return 1;\n} };\ntrigger.fire;\n` },
  { name: "in-setter", text: body => `const trigger = { set fire(v) {\n${body}} };\ntrigger.fire = 1;\n` },
  { name: "in-value-of", text: body => `const trigger = { valueOf() {\n${body}return 1;\n} };\n+trigger;\n` },
  { name: "in-to-string", text: body => `const trigger = { toString() {\n${body}return "";\n} };\n\`\${trigger}\`;\n` },
  { name: "in-to-primitive", text: body => `const trigger = { [Symbol.toPrimitive]() {\n${body}return 1;\n} };\ntrigger * 2;\n` },
  { name: "in-key-conversion", text: body => `const trigger = { toString() {\n${body}return "unrelated";\n} };\n({})[trigger];\n` },
  { name: "in-comparison", text: body => `const trigger = { valueOf() {\n${body}return 1;\n} };\ntrigger < 2;\n` },
  { name: "in-finally", text: body => `try {\nnote("tried");\n} finally {\n${body}}\n` },
  { name: "in-finally-after-throw", text: body => `try {\ntry {\nthrow new Error("thrown");\n} finally {\n${body}}\n} catch {}\n` },
  { name: "in-catch", text: body => `try {\nthrow new Error("thrown");\n} catch {\n${body}}\n` },
  { name: "in-catch-of-callee", text: body => `const fails = () => { throw new Error("thrown"); };\ntry {\nfails();\n} catch {\n${body}}\n` },
  { name: "in-iterator-next", text: body => `for (const step of { [Symbol.iterator]() { return { next() {\n${body}return { done: true, value: undefined };\n} }; } });\n` },
  { name: "in-iterator-return", text: body => `for (const step of { [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; }, return() {\n${body}return {};\n} }; } }) break;\n` },
  { name: "in-proxy-trap", text: body => `new Proxy({}, { get() {\n${body}return 1;\n} }).anything;\n` },
  { name: "in-has-instance", text: body => `1 instanceof { [Symbol.hasInstance]() {\n${body}return true;\n} };\n` },
  { name: "in-default-parameter", text: body => `(function (value = (() => {\n${body}})()) {})();\n` },
  { name: "in-constructor", text: body => `new (class {\nconstructor() {\n${body}}\n})();\n` },
  { name: "in-field-initializer", text: body => `new (class {\nfield = (() => {\n${body}})();\n})();\n` },
  { name: "in-static-block", text: body => `(class {\nstatic {\n${body}}\n});\n` },
  { name: "in-computed-member-name", text: body => `(class {\n[(() => {\n${body}return "unrelated";\n})()]() {}\n});\n` },
  { name: "in-bound-function", text: body => `(function () {\n${body}}).bind(null)();\n` },
  { name: "in-applied-function", text: body => `Reflect.apply(function () {\n${body}}, null, []);\n` },
  { name: "in-called-function", text: body => `(function () {\n${body}}).call(null);\n` },
  { name: "in-map-for-each", text: body => `new Map([[1, 1]]).forEach(() => {\n${body}});\n` },
  { name: "in-generator-step", text: body => `(function* () {\n${body}yield 1;\n})().next();\n` },
  { name: "in-tagged-template", text: body => `(() => {\n${body}})\`\`;\n` },
  { name: "after-await", text: body => `await null;\n${body}`, isAsync: true },
  { name: "in-then", text: body => `await Promise.resolve().then(() => {\n${body}});\n`, isAsync: true },
  { name: "in-thenable", text: body => `await { then(resolve) {\n${body}resolve(1);\n} };\n`, isAsync: true },
  { name: "in-another-task", text: body => `const other = (async () => {\nawait null;\n${body}})();\nawait other;\n`, isAsync: true },
  { name: "in-for-await", text: body => `for await (const step of (async function* () {\n${body}yield 1;\n})());\n`, isAsync: true },
];

/** A way from the object that is changed to another expression for the same object. `setup` runs before the first look. */
interface Route {
  name: string;
  setup?: (subject: string) => string;
  reach: (subject: string) => string;
  isAsync?: boolean;
  usesLibrary?: boolean;
}

const routes: Route[] = [
  { name: "through-second-variable", setup: x => `const alias = ${x};\n`, reach: () => `alias` },
  { name: "through-field", setup: x => `const box = { held: ${x} };\n`, reach: () => `box.held` },
  { name: "through-computed-field", setup: x => `const box = {};\nbox["he" + "ld".slice(0)] = ${x};\n`, reach: () => `box.held` },
  { name: "through-symbol-field", setup: x => `const slot = Symbol("slot");\nconst box = { [slot]: ${x} };\n`, reach: () => `box[slot]` },
  { name: "through-private-field", setup: x => `class Box {\n#held;\nconstructor(held) { this.#held = held; }\ntake() { return this.#held; }\n}\nconst box = new Box(${x});\n`, reach: () => `box.take()` },
  { name: "through-static-field", setup: x => `class Box {\nstatic held;\n}\nBox.held = ${x};\n`, reach: () => `Box.held` },
  { name: "through-getter", setup: x => `const kept = ${x};\nconst box = { get held() { return kept; } };\n`, reach: () => `box.held` },
  { name: "through-element", setup: x => `const list = [${x}];\n`, reach: () => `list[0]` },
  { name: "through-nested-element", setup: x => `const list = [[${x}]];\n`, reach: () => `list[0][0]` },
  { name: "through-pushed-element", setup: x => `const list = [];\nlist.push(${x});\n`, reach: () => `list[list.length - 1]` },
  { name: "through-popped-element", setup: x => `const list = [${x}];\n`, reach: () => `list.pop()` },
  { name: "through-array-destructuring", setup: x => `const [held] = [${x}];\n`, reach: () => `held`, usesLibrary: true },
  { name: "through-found-element", setup: x => `const list = [${x}];\n`, reach: () => `list.find(() => true)`, usesLibrary: true },
  { name: "through-sliced-array", setup: x => `const list = [${x}].slice();\n`, reach: () => `list[0]` },
  { name: "through-concatenated-array", setup: x => `const list = [].concat([${x}]);\n`, reach: () => `list[0]` },
  { name: "through-spread-array", setup: x => `const list = [...[${x}]];\n`, reach: () => `list[0]`, usesLibrary: true },
  { name: "through-array-from", setup: x => `const list = Array.from([${x}]);\n`, reach: () => `list[0]`, usesLibrary: true },
  { name: "through-array-of", setup: x => `const list = Array.of(${x});\n`, reach: () => `list[0]` },
  { name: "through-object-values", setup: x => `const list = Object.values({ held: ${x} });\n`, reach: () => `list[0]`, usesLibrary: true },
  { name: "through-object-entries", setup: x => `const list = Object.entries({ held: ${x} });\n`, reach: () => `list[0][1]`, usesLibrary: true },
  { name: "through-from-entries", setup: x => `const box = Object.fromEntries([["held", ${x}]]);\n`, reach: () => `box.held`, usesLibrary: true },
  { name: "through-assigned-copy", setup: x => `const box = Object.assign({}, { held: ${x} });\n`, reach: () => `box.held` },
  { name: "through-spread-copy", setup: x => `const box = { ...{ held: ${x} } };\n`, reach: () => `box.held` },
  { name: "through-descriptor", setup: x => `const box = Object.defineProperty({}, "held", { value: ${x} });\n`, reach: () => `Object.getOwnPropertyDescriptor(box, "held").value` },
  { name: "through-map", setup: x => `const table = new Map([["held", ${x}]]);\n`, reach: () => `table.get("held")` },
  { name: "through-map-filled-later", setup: x => `const table = new Map();\ntable.set("held", ${x});\n`, reach: () => `table.get("held")` },
  { name: "through-map-key", setup: x => `const table = new Map();\ntable.set(${x}, 1);\n`, reach: () => `table.keys().next().value`, usesLibrary: true },
  { name: "through-set", setup: x => `const table = new Set([${x}]);\n`, reach: () => `table.values().next().value`, usesLibrary: true },
  { name: "through-weak-map", setup: x => `const key = {};\nconst table = new WeakMap([[key, ${x}]]);\n`, reach: () => `table.get(key)` },
  { name: "through-weak-reference", setup: x => `const reference = new WeakRef(${x});\n`, reach: () => `reference.deref()` },
  { name: "through-error-cause", setup: x => `const failure = new Error("failed", { cause: ${x} });\n`, reach: () => `failure.cause` },
  { name: "through-global-property", setup: x => `globalThis.heldForTheChange = ${x};\n`, reach: () => `globalThis.heldForTheChange` },
  { name: "through-proxy", setup: x => `const wrapped = new Proxy(${x}, {});\n`, reach: () => `wrapped` },
  { name: "through-revocable-proxy", setup: x => `const wrapped = Proxy.revocable(${x}, {}).proxy;\n`, reach: () => `wrapped` },
  { name: "through-object-call", reach: x => `Object(${x})` },
  { name: "through-frozen-box", setup: x => `const box = Object.freeze({ held: ${x} });\n`, reach: () => `box.held` },
  { name: "through-returned-value", setup: () => `const same = x => x;\n`, reach: x => `same(${x})` },
  { name: "through-bound-argument", setup: x => `const take = function (x) { return x; }.bind(null, ${x});\n`, reach: () => `take()` },
  { name: "through-bound-this", setup: x => `const take = function () { return this; }.bind(${x});\n`, reach: () => `take()` },
  { name: "through-spread-argument", setup: () => `const same = x => x;\n`, reach: x => `same(...[${x}])`, usesLibrary: true },
  { name: "through-rest-parameter", setup: () => `const first = (...all) => all[0];\n`, reach: x => `first(${x})` },
  { name: "through-default-parameter", setup: x => `const kept = ${x};\nconst take = (x = kept) => x;\n`, reach: () => `take()` },
  { name: "through-reflect-apply", setup: () => `const same = x => x;\n`, reach: x => `Reflect.apply(same, null, [${x}])`, usesLibrary: true },
  { name: "through-constructor-return", setup: () => `function Same(x) { return x; }\n`, reach: x => `new Same(${x})` },
  { name: "through-destructuring", setup: x => `const { held } = { held: ${x} };\n`, reach: () => `held` },
  { name: "through-conditional", reach: x => `(count >= 0 ? ${x} : {})` },
  { name: "through-logical-or", reach: x => `(null || ${x})` },
  { name: "through-comma", reach: x => `(0, ${x})` },
  { name: "through-yielded-value", setup: x => `const walk = (function* (x) { yield x; })(${x});\n`, reach: () => `walk.next().value`, usesLibrary: true },
  { name: "through-value-sent-to-generator", setup: x => `const walk = (function* () { const got = yield 0; yield got; })();\nwalk.next();\nconst sent = walk.next(${x}).value;\n`, reach: () => `sent`, usesLibrary: true },
  { name: "through-tagged-template", setup: () => `const second = (strings, x) => x;\n`, reach: x => `second\`\${${x}}\`` },
  { name: "through-json-reviver-holder", setup: x => `const kept = ${x};\nconst parsed = JSON.parse("[0]", (key, value) => (key === "0" ? kept : value));\n`, reach: () => `parsed[0]` },
  { name: "through-replacer-this", setup: x => `let seenByReplacer;\nJSON.stringify({ held: ${x} }, function (key, value) { if (key === "held") seenByReplacer = this.held; return 0; });\n`, reach: () => `seenByReplacer` },
  { name: "through-sort-argument", setup: x => `let compared;\n[${x}, ${x}].sort((p, q) => { compared = p; return 0; });\n`, reach: () => `compared`, usesLibrary: true },
  { name: "through-awaited-value", setup: x => `const awaited = await Promise.resolve([${x}]);\n`, reach: () => `awaited[0]`, isAsync: true },
  { name: "through-promise-all", setup: x => `const awaited = await Promise.all([[${x}]]);\n`, reach: () => `awaited[0][0]`, isAsync: true, usesLibrary: true },
];

/** The routes and the triggers that need no await. */
export const routeNames = routes.filter(route => !route.isAsync).map(route => route.name);
export const triggerNames = triggers.filter(trigger => !trigger.isAsync).map(trigger => trigger.name);

const places: Place[] = [
  { name: "before-first-use", text: p => inFunction(`const o = ${p.make};\n${p.change(p.subject("o"))}${p.look("o", `"after"`)}`) },
  { name: "before-first-instance", text: p => inFunction(`${p.change(p.subject("o"))}const o = ${p.make};\n${p.look("o", `"after"`)}`), needsOtherTarget: true },
  { name: "between-uses", text: p => inFunction(around(p, p.change(p.subject("o")))) },
  { name: "at-top-level", text: p => `try {\n${locals}${around(p, p.change(p.subject("o")))}} catch (e) {\n${reportFailure}}\n` },
  {
    name: "between-instances",
    text: p => inFunction(`const first = ${p.make};\n${p.look("first", `"first before"`)}${p.change(p.subject("first"))}const second = ${p.make};\n${p.look("second", `"second"`)}${p.look("first", `"first after"`)}`),
  },
  { name: "after-two-instances", text: p => inFunction(`const first = ${p.make};\nconst second = ${p.make};\n${p.change(p.subject("first"))}${p.look("second", `"second"`)}${p.look("first", `"first"`)}`) },
  { name: "in-callee", text: p => `function change(x) {\n${p.change("x")}}\n${inFunction(around(p, `change(${p.subject("o")});\n`))}` },
  { name: "look-in-callee", text: p => `function report(x, label) {\n${locals}${p.look("x", "label")}}\n${inFunction(`const o = ${p.make};\nreport(o, "before");\n${p.change(p.subject("o"))}report(o, "after");\n`)}` },
  {
    name: "both-in-callees",
    text: p => `function change(x) {\n${p.change("x")}}\nfunction report(x, label) {\n${locals}${p.look("x", "label")}}\n${inFunction(`const o = ${p.make};\nreport(o, "before");\nchange(${p.subject("o")});\nreport(o, "after");\n`)}`,
  },
  { name: "in-callee-of-callee", text: p => `function change(x) {\n${p.change("x")}}\nfunction passOn(x) { change(x); }\n${inFunction(around(p, `passOn(${p.subject("o")});\n`))}` },
  { name: "through-this", text: p => `function change() {\n${p.change("this")}}\n${inFunction(around(p, `change.call(${p.subject("o")});\n`))}` },
  { name: "through-arguments", text: p => `function change() {\n${p.change("arguments[0]")}}\n${inFunction(around(p, `change(${p.subject("o")});\n`))}` },
  { name: "through-module-variable", text: p => `let shared;\nfunction change() {\n${p.change("shared")}}\n${inFunction(around(p, `change();\n`, `shared = ${p.subject("o")};\n`))}` },
  {
    name: "one-of-many",
    text: p => inFunction(`const all = [];\nfor (let i = 0; i < 6; i++) all.push(${p.make});\n${p.change(p.subject("all[3]"))}for (let i = 0; i < 6; i++) {\nconst o = all[i];\n${p.look("o", `"object " + i`)}}\n`),
  },
  { name: "on-one-path", text: p => inFunction(`for (let i = 0; i < 4; i++) {\nconst o = ${p.make};\nif (i & 1) {\n${p.change(p.subject("o"))}}\n${p.look("o", `"round " + i`)}}\n`) },
  {
    name: "at-iteration",
    text: p => inFunction(`const o = ${p.make};\nlet last = "";\nfor (let i = 0; i < 300; i++) {\nif (i === 150) {\n${p.change(p.subject("o"))}}\n${p.observe("o")}if (line !== last) {\nprint(i + ": " + line);\nlast = line;\n}\n}\n`),
  },
  {
    name: "at-iteration-in-callee",
    text: p =>
      `function change(x) {\n${p.change("x")}}\n${inFunction(`const o = ${p.make};\nlet last = "";\nfor (let i = 0; i < 300; i++) {\nif (i === 150) change(${p.subject("o")});\n${p.observe("o")}if (line !== last) {\nprint(i + ": " + line);\nlast = line;\n}\n}\n`)}`,
  },
  {
    name: "at-iteration-over-many",
    text: p =>
      inFunction(`const all = [];\nfor (let i = 0; i < 8; i++) all.push(${p.make});\nlet last = "";\nfor (let i = 0; i < 300; i++) {\nconst o = all[i & 7];\nif (i === 150) {\n${p.change(p.subject("o"))}}\n${p.observe("o")}if (line !== last) {\nprint(i + ": " + line);\nlast = line;\n}\n}\n`),
  },
  { name: "between-yields", text: p => `function* steps(x) {\n${locals}${p.look("x", `"before"`)}yield 1;\n${p.look("x", `"after"`)}}\n${inFunction(`const o = ${p.make};\nconst walk = steps(o);\nwalk.next();\n${p.change(p.subject("o"))}walk.next();\n`)}` },
  { name: "generator-changes", text: p => `function* steps(x) {\nyield 1;\n${p.change("x")}yield 2;\n}\n${inFunction(`const o = ${p.make};\nconst walk = steps(${p.subject("o")});\nwalk.next();\n${p.look("o", `"before"`)}walk.next();\n${p.look("o", `"after"`)}`)}` },
  {
    name: "while-awaiting",
    text: p => `let release;\nconst gate = new Promise(resolve => { release = resolve; });\n${inFunction(`const o = ${p.make};\nPromise.resolve().then(() => {\n${p.change(p.subject("o"))}release();\n});\n${p.look("o", `"before"`)}await gate;\n${p.look("o", `"after"`)}`, "async function")}`,
  },
  {
    name: "during-the-look",
    text: p =>
      inFunction(`const o = ${p.make};\nlet isDone = false;\nObject.defineProperty(o, "a", { get() {\n${once(p.change(p.subject("o")))}return 1;\n}, enumerable: true, configurable: true });\n${p.look("o", `"during"`)}${p.look("o", `"after"`)}`),
  },
  { name: "during-for-in", text: p => inFunction(`const o = ${p.make};\nlet isDone = false;\nconst visited = [];\nfor (const key in o) {\nvisited.push(key);\n${once(p.change(p.subject("o")))}}\nprint("visited: " + visited.length + " " + visited.slice(0, 12).join());\n${p.look("o", `"after"`)}`) },
  {
    name: "during-for-of",
    text: p => inFunction(`const o = ${p.make};\nlet isDone = false;\nconst visited = [];\ntry {\nfor (const element of o) {\nvisited.push(str(element));\nif (visited.length > 11) break;\n${once(p.change(p.subject("o")))}}\n} catch (e) {\nvisited.push("threw " + e.name);\n}\nprint("visited: " + visited.join());\n${p.look("o", `"after"`)}`),
    needsArrayLike: true,
  },
  {
    name: "during-index-loop",
    text: p => inFunction(`const o = ${p.make};\nlet isDone = false;\nconst visited = [];\nfor (let i = 0; i < o.length && i < 12; i++) {\nvisited.push(str(o[i]));\n${once(p.change(p.subject("o")))}}\nprint("visited: " + visited.join());\n${p.look("o", `"after"`)}`),
    needsArrayLike: true,
  },
  ...routes.map(
    (route): Place => ({
      name: route.name,
      text: p => inFunction(around(p, p.change(route.reach(p.subject("o"))), route.setup?.(p.subject("o")) ?? ""), route.isAsync ? "async function" : "function"),
      usesLibrary: route.usesLibrary,
    }),
  ),
  {
    name: "through-thrown-value",
    text: p => inFunction(around(p, `try {\nthrow ${p.subject("o")};\n} catch (caught) {\n${p.change("caught")}}\n`)),
  },
  ...triggers.map(
    (trigger): Place => ({
      name: trigger.name,
      text: p => inFunction(around(p, trigger.text(p.change(p.subject("o")))), trigger.isAsync ? "async function" : "function"),
      usesLibrary: trigger.usesLibrary,
    }),
  ),
];

const helperTexts: Record<string, string> = {
  listed: `function saysWhereItWasMade(key) {
  return key === "line" || key === "column" || key === "sourceURL" || key === "stack" || key === "originalLine" || key === "originalColumn";
}
function shortened(text) {
  if (text.length <= 400) return text;
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return text.slice(0, 150) + " .. " + text.length + " characters, sum " + sum + " .. " + text.slice(-150);
}
function listed(items) {
  let text = "";
  let size = 0;
  for (let i = 0; i < items.length; i++) {
    if (saysWhereItWasMade(items[i])) continue;
    text += (size++ ? "," : "") + String(items[i]);
  }
  return shortened(size + " [" + text + "]");
}
`,
  contents: `function contents(copy) {
  const found = [];
  for (const key of Reflect.ownKeys(copy)) found.push(String(key) + "=" + str(copy[key]));
  return listed(found);
}
`,
  described: `function described(descriptor) {
  if (descriptor === undefined) return "none";
  const kind = "value" in descriptor ? "value " + str(descriptor.value) + (descriptor.writable ? " writable" : "") : "accessor" + (descriptor.get ? " get" : "") + (descriptor.set ? " set" : "");
  return kind + (descriptor.enumerable ? " enumerable" : "") + (descriptor.configurable ? " configurable" : "");
}
`,
};

const prelude = `let count = 0;
let trail = "";
function note(text) {
  count++;
  trail += text + "; ";
}
function str(v) {
  if (typeof v === "string") return '"' + v + '"';
  if (typeof v === "function") return "function";
  if (typeof v === "symbol") return "symbol";
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "object" && v !== null) return "object";
  if (v === 0 && 1 / v < 0) return "-0";
  return "" + v;
}
`;
const spellers = `function spell(text) {
  let result = "";
  for (let i = 0; i < text.length; i++) result += text[i];
  return result;
}
function tally(limit) {
  let result = 0;
  while (result < limit) result++;
  return result;
}
`;

export interface Combination {
  holder: Holder;
  integrity: Integrity;
  above: Above;
  target: Target;
  operation: Operation;
  key: Key;
  /** The object has the key from its creation on. */
  isOwn: boolean;
  /** How the change spells the key, and how the look does. */
  changeSpelling: Spelling;
  lookSpelling: Spelling;
  place: Place;
  look: Look;
}

function isPossible({ holder, integrity, above, target, operation, key, isOwn, place, look }: Combination): boolean {
  if (above.declared && !holder.declaresMembersAbove) return false;
  if (above.planted && !(above.isFar ? holder.grand : holder.proto)) return false;
  if (target === "prototype" && !holder.proto) return false;
  if (target === "prototype-above" && !holder.grand) return false;
  if (target === "class-object" && !holder.class) return false;
  if (place.needsOtherTarget && target === "itself") return false;
  if ((integrity === "frozen" || integrity === "sealed") && holder.refusesFreeze) return false;
  if (holder.hasStaticFields && isOwn && key.name === "prototype") return false;
  if (holder.isNamespace && ((isOwn && (!key.member || key.name === "m")) || integrity === "frozen")) return false;
  if ((place.needsArrayLike || look.needsArrayLike) && !holder.isArrayLike) return false;
  if (operation.needsArrayLike && !(holder.isArrayLike && target === "itself")) return false;
  if (look.needsClass && !holder.class) return false;
  if (look.needsCalledKey && !key.isCalled) return false;
  if (operation.refusesCalledKey && key.isCalled) return false;
  if (look.refusesCallable && holder.isCallable) return false;
  if (look.needsHost && !holder.hasHost) return false;
  if (look.needsCallable && !holder.isCallable) return false;
  if (look.readsNameOfBoundFunction && holder.isNamedByComputedKey) return false;
  // Function.prototype.toString answers the source text, which a transpiler formats.
  if (look.needsCalledKey && holder.isCallable && key.name === "toString") return false;
  return true;
}

const usesLibrary = ({ holder, operation, place, look }: Combination) => !!(holder.usesLibrary || operation.usesLibrary || place.usesLibrary || look.usesLibrary);

const guarded = (body: string, handler: string) => `try {\n${body}} catch (e) {\n${handler}}\n`;

/** The import declarations of a program, which stand at the top of its file. Sloppy code is CommonJS and calls `require`. */
export function importsOf({ holder }: Combination, isStrict = true): string {
  if (!holder.imports) return "";
  const [names, module] = holder.imports;
  return isStrict ? `import ${names} from ${JSON.stringify(module)};\n` : `const ${names} = require(${JSON.stringify(module)});\n`;
}

/** The program without its imports. */
export function bodyOf(combination: Combination, print = "print", isStrict = true, fileName = nameOf(combination) + ".js"): string {
  const { holder, integrity, above, target, operation, key, isOwn, changeSpelling, lookSpelling, place, look } = combination;
  const own: Property[] = [{ key: named("a"), value: "1" }, ...(isOwn ? [{ key, value: key.ownValue ?? "2" }] : []), { key: named("z"), value: "3" }];
  const siteOf = (object: string, spelling: Spelling): Site => ({
    object,
    key: spelling === "computed" ? "name" : key.constant,
    inLiteral: spelling === "computed" ? "[name]" : key.inLiteral,
    at: other => access(other, key, spelling),
    holder,
    arrayCall: (name, parameters = "") => (holder.isArray ? `${object}.${name}(${parameters})` : `Array.prototype.${name}.call(${object}${parameters ? ", " + parameters : ""})`),
  });
  const observe = (object: string) => `before = count;\n${guarded(look.text(siteOf(object, lookSpelling)), `seen = "threw " + e.name;\n`)}line = seen + " | " + (count - before) + " " + trail;\ntrail = "";\n`;
  const parts: Parts = {
    make: "make()",
    subject: object => (target === "itself" ? object : target === "prototype" ? holder.proto! : target === "prototype-above" ? holder.grand! : holder.class!),
    change: subject => guarded(operation.text(siteOf(subject, changeSpelling)), `note("the change threw " + e.name);\n`),
    observe,
    look: (object, label) => `${observe(object)}print(${label} + ": " + line);\n`,
  };
  const declared = [`m() { return "m"; }`, ...(above.declared?.(key.inLiteral) ?? [])];
  const members: Members = { inClass: declared.join("\n  "), inLiteral: declared.join(", ") };
  const body = holder.make(own, members);
  const make = integrity === "open" ? `function make() {\n${body}\n}\n` : `function create() {\n${body}\n}\nfunction make() {\n  return ${integrityFunctions[integrity]}(create());\n}\n`;
  const isComputed = changeSpelling === "computed" || lookSpelling === "computed";
  const helpers = [...new Set(look.helpers ?? [])].map(name => helperTexts[name]).join("");
  return [
    isStrict ? `"use strict";\n` : "",
    print === "print" ? "" : `const print = text => ${print}(text);\n`,
    prelude,
    helpers,
    key.before ?? "",
    isComputed ? `${spellers}${key.beforeComputed ?? ""}const name = ${key.computed};\n` : "",
    (holder.define?.(own, members) ?? "").replace("FILE", fileName),
    above.planted ? `Object.defineProperty(${above.isFar ? holder.grand : holder.proto}, ${key.constant}, ${above.planted});\n` : "",
    make,
    operation.before?.(siteOf("", changeSpelling)) ?? "",
    look.before?.(siteOf("", lookSpelling)) ?? "",
    place.text(parts),
    `print("end: " + count + " " + trail);\n`,
  ].join("");
}

export function textOf(combination: Combination, print = "print", isStrict = true, fileName = nameOf(combination) + ".js"): string {
  return importsOf(combination, isStrict) + bodyOf(combination, print, isStrict, fileName);
}

export const nameOf = ({ holder, integrity, above, target, operation, key, isOwn, changeSpelling, lookSpelling, place, look }: Combination) =>
  `${holder.name}${integrity === "open" ? "" : "+" + integrity}.${above.name}.${target}.${operation.name}.${key.name}${isOwn ? "+own" : ""}.${changeSpelling}-${lookSpelling}.${place.name}.${look.name}`;

export interface Axes {
  holders: Holder[];
  integrities: Integrity[];
  aboves: Above[];
  targets: Target[];
  operations: Operation[];
  keys: Key[];
  presences: boolean[];
  spellings: [Spelling, Spelling][];
  places: Place[];
  looks: Look[];
}

const allSpellings: [Spelling, Spelling][] = [
  ["constant", "constant"],
  ["constant", "computed"],
  ["computed", "constant"],
  ["computed", "computed"],
];
export const allAxes: Axes = { holders, integrities, aboves, targets, operations, keys, presences: [true, false], spellings: allSpellings, places, looks };

const chosen = <T extends { name: string }>(items: T[], names: string[] | undefined) => {
  if (!names) return items;
  const unknown = names.filter(name => !items.some(item => item.name === name));
  if (unknown.length) throw new Error(`unknown: ${unknown.join(", ")}`);
  return items.filter(item => names.includes(item.name));
};

/** The axes cut down to the given names. An axis that is left out stays whole. */
export function axesOf(names: Partial<Record<keyof Axes, string[]>>): Axes {
  return {
    holders: chosen(holders, names.holders),
    integrities: names.integrities ? integrities.filter(integrity => names.integrities!.includes(integrity)) : integrities,
    aboves: chosen(aboves, names.aboves),
    targets: names.targets ? targets.filter(target => names.targets!.includes(target)) : targets,
    operations: chosen(operations, names.operations),
    keys: chosen(keys, names.keys),
    presences: names.presences ? [true, false].filter(isOwn => names.presences!.includes(isOwn ? "own" : "absent")) : [true, false],
    spellings: names.spellings ? allSpellings.filter(([change, look]) => names.spellings!.includes(`${change}-${look}`)) : allSpellings,
    places: chosen(places, names.places),
    looks: chosen(looks, names.looks),
  };
}

/** The combination that `nameOf` gives the name. */
export function combinationOf(name: string): Combination {
  const [holder, above, target, operation, key, spelling, place, look] = name.split(".");
  const [holderName, integrity = "open"] = holder.split("+");
  const [keyName, presence = "absent"] = key.split("+");
  const axes = axesOf({ holders: [holderName], integrities: [integrity], aboves: [above], targets: [target], operations: [operation], keys: [keyName], presences: [presence], spellings: [spelling], places: [place], looks: [look] });
  const [combination] = combinations(axes);
  if (!combination) throw new Error(`no such combination: ${name}`);
  return combination;
}

export const sizeOf = (axes: Axes) => Object.values(axes).reduce((product, axis) => product * axis.length, 1);

export function* combinations(axes: Axes = allAxes): Generator<Combination> {
  for (const holder of axes.holders)
    for (const integrity of axes.integrities)
      for (const above of axes.aboves)
        for (const target of axes.targets)
          for (const operation of axes.operations)
            for (const key of axes.keys)
              for (const isOwn of axes.presences)
                for (const [changeSpelling, lookSpelling] of axes.spellings)
                  for (const place of axes.places)
                    for (const look of axes.looks) {
                      const combination = { holder, integrity, above, target, operation, key, isOwn, changeSpelling, lookSpelling, place, look };
                      if (isPossible(combination)) yield combination;
                    }
}

/** One combination, drawn with `pick`. `hasLibrary`: built-ins written in JavaScript and the modules of the host are there. `hasFileName`: the program is stored under the name that `textOf` is told. */
export function pickCombination(pick: <T>(items: readonly T[]) => T, { hasLibrary, hasFileName = false }: { hasLibrary: boolean; hasFileName?: boolean }, axes: Axes = allAxes): Combination {
  for (;;) {
    const [changeSpelling, lookSpelling] = pick(axes.spellings);
    const combination = {
      holder: pick(axes.holders),
      // Two of three objects are open, half have nothing above them under the key, and half of the changes are made to the object itself.
      integrity: axes.integrities.includes("open") && pick([0, 1, 2]) ? "open" : pick(axes.integrities),
      above: axes.aboves.includes(aboves[0]) && pick([0, 1]) ? aboves[0] : pick(axes.aboves),
      target: axes.targets.includes("itself") && pick([0, 1]) ? "itself" : pick(axes.targets),
      operation: pick(axes.operations),
      // Every third key is the plain name.
      key: axes.keys.includes(keys[0]) && !pick([0, 1, 2]) ? keys[0] : pick(axes.keys),
      isOwn: pick(axes.presences),
      changeSpelling,
      lookSpelling,
      place: pick(axes.places),
      look: pick(axes.looks),
    };
    if (!isPossible(combination)) continue;
    if (!hasLibrary && usesLibrary(combination)) continue;
    if (!hasFileName && combination.holder.isNamespace) continue;
    return combination;
  }
}

/** Programs with many combinations each, every combination in a function of its own. */
export function programsBy(group: (combination: Combination) => string, axes: Axes): { name: string; text: string }[] {
  const groups = Map.groupBy(
    combinations(axes).filter(combination => !combination.holder.isNamespace),
    group,
  );
  return [...groups].map(([name, members]) => ({
    name,
    text: [...new Set(members.map(combination => importsOf(combination)))].join("") + members.map(combination => `console.log(${JSON.stringify("## " + nameOf(combination))});\n(() => {\n${bodyOf(combination, "console.log")}})();\n`).join(""),
  }));
}

export interface Plane {
  title: string;
  /** The programs that run in every run of the test. */
  alwaysRun: string[];
  programs: { name: string; text: string }[];
}

/** The part of the table that ../generated-object-mutations.test.ts runs. */
export function testPlanes(): Plane[] {
  const instances = ["class-fields", "class-constructor", "class-stores-in-method", "subclass", "subclass-fields", "subclass-without-constructor", "mixin", "constructor-function", "class-over-function", "literal-with-prototype", "created", "heir-of-instance"];
  const byHolder = ({ holder }: Combination) => holder.name;
  const byHolderAndOperation = ({ holder, operation }: Combination) => `${holder.name}.${operation.name}`;
  const once = { integrities: ["open"], aboves: ["nothing-above"], targets: ["itself"], spellings: ["constant-constant"] };

  return [
    {
      title: "nothing reads the property, and something lies above the object",
      alwaysRun: ["class-fields", "subclass"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: instances,
          aboves: ["nothing-above", "declared-accessor", "declared-getter", "planted-setter", "planted-read-only"],
          operations: ["delete", "freeze", "define-read-only", "define-accessor", "prototype-to-accessor"],
          keys: ["k"],
          places: ["between-instances"],
          looks: ["store", "delete-then-store", "make-another"],
        }),
      ),
    },
    {
      title: "a member is planted above the object",
      alwaysRun: ["class-constructor"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: instances,
          targets: ["prototype", "prototype-above"],
          operations: ["define-accessor", "define-setter", "define-getter", "define-read-only", "define-data", "freeze", "delete-method", "prototype-to-proxy"],
          keys: ["k", "m"],
          places: ["before-first-instance", "between-instances", "between-uses"],
          looks: ["read", "store", "call-method", "make-another"],
        }),
      ),
    },
    {
      title: "the changed object is reached by a route",
      alwaysRun: ["class-fields.define-accessor"],
      programs: programsBy(
        byHolderAndOperation,
        axesOf({ ...once, holders: ["class-fields", "literal", "array"], operations: ["define-accessor", "store-text", "delete", "freeze"], keys: ["k", "index-1"], presences: ["own"], places: [...routeNames, "through-thrown-value"], looks: ["read", "store"] }),
      ),
    },
    {
      title: "the change runs inside something else",
      alwaysRun: ["class-constructor.delete"],
      programs: programsBy(
        byHolderAndOperation,
        axesOf({ ...once, holders: ["class-constructor", "literal"], operations: ["define-accessor", "store-text", "delete", "freeze"], keys: ["k"], presences: ["own"], places: [...triggerNames, "at-iteration", "at-iteration-in-callee", "one-of-many", "on-one-path"], looks: ["read", "store"] }),
      ),
    },
    {
      title: "the keys in their order",
      alwaysRun: ["class-fields"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: ["literal", "literal-filled-later", "class-fields", "class-constructor", "class-private-beside", "subclass", "created", "created-without-prototype", "parsed", "spread-copy"],
          operations: ["delete-and-store", "delete-first-and-store", "define-hidden", "define-accessor", "add-7", "add-65", "add-index-and-symbol", "assign"],
          keys: ["k", "index-1", "text-minus-1", "own-symbol"],
          presences: ["own"],
          places: ["between-uses"],
          looks: ["keys", "own-keys", "for-in", "json", "spread", "descriptors"],
        }),
      ),
    },
    {
      title: "function objects, class objects and prototype objects",
      alwaysRun: ["subclass-statics"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: ["function", "arrow-function", "bound-function", "class-statics", "subclass-statics", "prototype-object"],
          operations: ["define-read-only", "define-accessor", "delete", "freeze", "store-text", "prototype-to-data"],
          keys: ["k", "name", "length", "prototype"],
          places: ["between-uses"],
          looks: ["read", "keys", "names", "for-in", "descriptor", "store"],
        }),
      ),
    },
    {
      title: "a function written in a literal or a class is changed and read from there again",
      alwaysRun: ["method-in-literal", "arrow-in-literal", "method-in-class"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: holders.filter(holder => holder.hasHost).map(holder => holder.name),
          operations: ["define-accessor", "delete", "freeze", "store-text", "add-7"],
          keys: ["k", "name", "prototype"],
          presences: ["own"],
          places: ["between-uses", "between-instances"],
          looks: ["names", "same-when-read-again", "read-through-its-host", "store-through-its-host", "same-by-every-way-of-reading", "name-and-length"],
        }),
      ),
    },
    {
      title: "arrays and what is like them",
      alwaysRun: ["array"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: ["array", "array-of-doubles", "array-of-objects", "array-with-hole", "array-pushed", "array-subclass", "array-like", "arguments", "bytes", "text-object"],
          operations: operations.filter(operation => operation.needsArrayLike).map(operation => operation.name),
          keys: ["index-1"],
          presences: ["absent"],
          places: ["between-uses", "during-index-loop", "at-iteration"],
          looks: ["elements", "length", "keys", "store-element"],
        }),
      ),
    },
    {
      title: "frozen, sealed and not extensible",
      alwaysRun: ["class-fields"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: ["literal", "class-fields", "class-constructor", "subclass", "created", "array", "function", "class-statics", "map-subclass"],
          integrities: ["frozen", "sealed", "not-extensible"],
          operations: ["define-data", "define-same-number", "switch-off-writable", "delete", "store-number", "add-1", "prototype-to-null", "prototype-to-the-same", "define-field", "reflect-set", "assign"],
          keys: ["k"],
          places: ["between-uses"],
          looks: ["read", "store", "store-fresh-name", "delete", "descriptor", "integrity"],
        }),
      ),
    },
  ];
}

function picker(seed: number) {
  let state = seed >>> 0;
  return <T>(items: readonly T[]): T => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return items[((mixed ^ (mixed >>> 14)) >>> 0) % items.length];
  };
}

if (import.meta.main) {
  const folder = process.argv[2];
  const option = (name: string) => process.argv.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3);
  const filter = new RegExp(option("filter") ?? ".");
  const withoutText = option("without-text") ? new RegExp(option("without-text")!) : undefined;
  const extension = option("extension") ?? ".js";
  const hasLibrary = option("library") !== "no";
  const axes = axesOf(Object.fromEntries(Object.keys(allAxes).flatMap(axis => (option(axis) ? [[axis, option(axis)!.split(",")]] : []))));
  const sample = Number(option("sample") ?? 0);
  const names = option("names");
  const writesPlanes = process.argv.includes("--planes");
  if (!sample && !names && !writesPlanes && sizeOf(axes) > 5_000_000) throw new Error(`${sizeOf(axes)} combinations: narrow the axes or pass --sample=<how many>`);
  mkdirSync(folder, { recursive: true });
  const written = new Set<string>();
  const groupSize = Number(option("group") ?? 0);
  let group: string[] = [];
  let groups = 0;
  const groupImports = new Set<string>();
  const writeGroup = () => {
    if (group.length) writeFileSync(join(folder, `group-${groups++}${extension}`), [...groupImports, ...group].join(""));
    group = [];
    groupImports.clear();
  };
  const write = (combination: Combination) => {
    const name = nameOf(combination);
    if (written.has(name) || !filter.test(name) || (!hasLibrary && usesLibrary(combination))) return;
    if (combination.holder.isNamespace && (extension === ".cjs" || groupSize)) return;
    const print = option("print") ?? "print";
    const text = (groupSize ? bodyOf : textOf)(combination, groupSize ? `(line => ${print}("${group.length}| " + line))` : print, extension !== ".cjs", name + extension);
    if (withoutText?.test(text)) return;
    written.add(name);
    if (!groupSize) return writeFileSync(join(folder, name + extension), text);
    groupImports.add(importsOf(combination, extension !== ".cjs"));
    group.push(`${print}(${JSON.stringify(`${group.length}| ## ${name}`)});\n(() => {\n${text}})();\n`);
    if (group.length === groupSize) writeGroup();
  };
  if (writesPlanes) {
    testPlanes().forEach((plane, index) => plane.programs.forEach(({ name, text }) => (written.add(`${index}-${name}`), writeFileSync(join(folder, `plane-${index}-strict-${name}.js`), text))));
  } else if (names) {
    for (const name of readFileSync(names, "utf8").split("\n")) if (name) write(combinationOf(name));
  } else if (sample) {
    const pick = picker(Number(option("seed") ?? 1));
    for (let attempts = 0; written.size < sample && attempts < sample * 200; attempts++) write(pickCombination(pick, { hasLibrary, hasFileName: true }, axes));
  } else for (const combination of combinations(axes)) write(combination);
  writeGroup();
  console.log(groupSize ? `${written.size} combinations in ${groups} programs` : `${written.size} programs`);
}
