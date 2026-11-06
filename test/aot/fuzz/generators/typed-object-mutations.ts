// The table of ./object-mutations.ts in TypeScript that the checker accepts under `strict`, without `any`, without a cast and without a declaration that has no body.
// A reference of a declared type is held somewhere. The object behind it is changed in a way that no type forbids. A look through the typed reference then sees what the language says it sees:
// a read of a field that is declared `number` runs the getter that was planted, answers the text that a wider alias stored, finds the value of the prototype once the field is deleted,
// and a store to a frozen object throws.
//
// The table is a cross product: the declared type and what satisfies it x what the prototype holds under the key x which object is changed x the change x the key x how the change spells the key
// x where the typed reference is held and when the change runs x whether the change stands in a callee x the look. An entry has the name it has in ./object-mutations.ts wherever it means the same.
//
// Where a change has put a value of another type under the key, a compiled program may throw a TypeError at the typed read. It never takes the value for what it is not.
// A look that throws prints THROWS and the kind of the error.
//
// A change takes the object under a type of its own choice, and every such type is one that the declared type is assignable to:
//   object            for the functions of Object and Reflect, which take any object, any key and any value
//   { k?: number }    the property made optional: it can be deleted and set to undefined
//   { k?: unknown }   the property made wider: it can hold anything
//
//   bun typed-object-mutations.ts <folder> [--filter=<regex over names>] [--sample=<how many>] [--seed=<number>] [--names=<file with a name on each line>]
//       [--planes] [--holders=a,b] [--aboves=..] [--targets=..] [--changes=..] [--keys=..] [--presences=..] [--spellings=..] [--places=..] [--callees=..] [--looks=..]
//
// writes <folder>/<name>.ts and a tsconfig.json. With --planes it writes the programs of `testPlanes` instead. The whole product is far too large to write: narrow the axes, or pass --sample. `pickCombination` draws one of them for another driver.
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

type Spelling = "constant" | "computed";

interface Key {
  name: string;
  /** The key as a constant expression. */
  constant: string;
  /** The key as it stands in a literal or in a type. */
  inLiteral: string;
  /** The property of an object under the key. */
  at: (object: string) => string;
  /** An expression that puts the same key together while the program runs, and the type of that expression. */
  computed: string;
  computedType: string;
  /** The declared type of the property, and two other values of that type: what a change puts there and what a look stores. */
  type: string;
  sameTypeValue: string;
  storedValue: string;
  isMethod?: boolean;
  isIndex?: boolean;
  /** The property holds an object of a class of the program. */
  isObject?: boolean;
}

const keys: Key[] = [
  { name: "k", constant: `"k"`, inLiteral: "k", at: object => `${object}.k`, computed: `spell("k")`, computedType: "string", type: "number", sameTypeValue: "9", storedValue: "5" },
  { name: "m", constant: `"m"`, inLiteral: "m", at: object => `${object}.m`, computed: `spell("m")`, computedType: "string", type: "() => string", sameTypeValue: `() => "replaced"`, storedValue: `() => "five"`, isMethod: true },
  { name: "inner", constant: `"inner"`, inLiteral: "inner", at: object => `${object}.inner`, computed: `spell("inner")`, computedType: "string", type: "Inner", sameTypeValue: "new DeepInner()", storedValue: "new Inner()", isObject: true },
  { name: "index-1", constant: "1", inLiteral: "1", at: object => `${object}[1]`, computed: "tally(1)", computedType: "number", type: "number", sameTypeValue: "9", storedValue: "5", isIndex: true },
];

/** The property made optional. */
const looseAlias = (key: Key) => (key.isIndex ? "Array<number | undefined>" : `{ ${key.inLiteral}?: ${key.type} }`);
/** The property made wider. */
const wideAlias = (key: Key) => (key.isIndex ? "unknown[]" : `{ ${key.inLiteral}?: unknown }`);
/** The property as it is declared. */
const exactAlias = (key: Key) => (key.isIndex ? "number[]" : `{ ${key.inLiteral}: ${key.type} }`);

interface Holder {
  name: string;
  /** The declarations. `hasKey`: the object has `k` from its creation on, and its type requires it. Otherwise the type declares `k` optional and the object lacks it. */
  define: (hasKey: boolean) => string;
  /** The body of `make`, which answers another object each time. */
  make: (hasKey: boolean) => string;
  /** The declared type of every reference to the object. */
  type: string;
  /** `make` has no declared result: the type is taken from it. */
  isInferred?: boolean;
  /** The prototype of the object and the prototype above it, where they belong to the program. */
  proto?: string;
  grand?: string;
  /** What `instanceof` is asked about. */
  class?: string;
  isArray?: boolean;
  /** Its type cannot declare `k` optional. */
  needsKey?: boolean;
  /** Its type declares `k` read-only. */
  isKeyReadOnly?: boolean;
  /** It has no method `double`, which reads `k` through `this`. */
  hasNoDouble?: boolean;
  /** A store to `k` runs a setter whose parameter is declared as a number. */
  hasTypedSetter?: boolean;
  isProxy?: boolean;
}

const method = `m(): string {\n    return "m";\n  }`;
/** The field as a number, in a method of the object. */
const ownNumber = (hasKey: boolean) => (hasKey ? "this.k" : "(this.k ?? 0)");
const double = (hasKey: boolean) => `double(): number {\n    return ${ownNumber(hasKey)} * 2;\n  }`;
const methods = (hasKey: boolean) => `${method}\n  ${double(hasKey)}`;
const fields = (hasKey: boolean) => `  a = 1;\n${hasKey ? "  k = 2;\n" : "  declare k?: number;\n"}  z = 3;\n  inner = new Inner();\n`;
const reversedFields = (hasKey: boolean) => `  inner = new Inner();\n  z = 3;\n${hasKey ? "  k = 2;\n" : "  declare k?: number;\n"}  a = 1;\n`;
const shape = (hasKey: boolean) => `interface Shape {\n  a: number;\n  k${hasKey ? "" : "?"}: number;\n  z: number;\n  inner: Inner;\n  m(): string;\n  double(): number;\n}\n`;
const literal = (hasKey: boolean) => `{ a: 1, ${hasKey ? "k: 2, " : ""}z: 3, inner: new Inner(), m() { return "m"; }, double() { return ${ownNumber(hasKey)} * 2; } }`;

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
  { name: "class-fields", define: hasKey => `class A {\n${fields(hasKey)}  ${methods(hasKey)}\n}\n`, make: () => `return new A();`, type: "A", proto: "A.prototype", class: "A" },
  {
    name: "class-constructor",
    define: hasKey =>
      `class A {\n  a: number;\n${hasKey ? "  k: number;\n" : "  declare k?: number;\n"}  z: number;\n  inner: Inner;\n  constructor() {\n    this.a = 1;\n${hasKey ? "    this.k = 2;\n" : ""}    this.z = 3;\n    this.inner = new Inner();\n  }\n  ${methods(hasKey)}\n}\n`,
    make: () => `return new A();`,
    type: "A",
    proto: "A.prototype",
    class: "A",
  },
  {
    name: "class-parameter-properties",
    define: () => `class A {\n  constructor(\n    public a: number,\n    public k: number,\n    public z: number,\n    public inner: Inner,\n  ) {}\n  ${methods(true)}\n}\n`,
    make: () => `return new A(1, 2, 3, new Inner());`,
    type: "A",
    proto: "A.prototype",
    class: "A",
    needsKey: true,
  },
  {
    name: "class-private-beside",
    define: hasKey => `class A {\n  #hidden = 7;\n${fields(hasKey)}  #last = 8;\n  m(): string {\n    return "m" + this.#hidden + this.#last;\n  }\n  ${double(hasKey)}\n}\n`,
    make: () => `return new A();`,
    type: "A",
    proto: "A.prototype",
    class: "A",
  },
  {
    name: "class-read-only-field",
    define: () => `class A {\n  a = 1;\n  readonly k: number = 2;\n  z = 3;\n  inner = new Inner();\n  ${methods(true)}\n}\n`,
    make: () => `return new A();`,
    type: "A",
    proto: "A.prototype",
    class: "A",
    needsKey: true,
    isKeyReadOnly: true,
  },
  {
    name: "subclass",
    define: hasKey => `class Base {\n  a = 1;\n${hasKey ? "  k = 2;\n" : "  declare k?: number;\n"}  inner = new Inner();\n  ${methods(hasKey)}\n}\nclass A extends Base {\n  z = 3;\n}\n`,
    make: () => `return new A();`,
    type: "A",
    proto: "A.prototype",
    grand: "Base.prototype",
    class: "A",
  },
  {
    name: "subclass-held-as-parent",
    define: hasKey => `class Base {\n${fields(hasKey)}  ${methods(hasKey)}\n}\nclass A extends Base {\n  extra = 4;\n  m(): string {\n    return "m of the subclass";\n  }\n}\n`,
    make: () => `return new A();`,
    type: "Base",
    proto: "A.prototype",
    grand: "Base.prototype",
    class: "Base",
  },
  {
    name: "abstract-parent",
    define: hasKey => `abstract class Base {\n${fields(hasKey)}  abstract m(): string;\n  ${double(hasKey)}\n}\nclass A extends Base {\n  ${method}\n}\n`,
    make: () => `return new A();`,
    type: "Base",
    proto: "A.prototype",
    grand: "Base.prototype",
    class: "Base",
  },
  {
    name: "generic-class",
    define: () => `class Cell<V> {\n  a = 1;\n  k: V;\n  z = 3;\n  inner = new Inner();\n  constructor(k: V) {\n    this.k = k;\n  }\n  ${method}\n}\n`,
    make: () => `return new Cell(2);`,
    type: "Cell<number>",
    proto: "Cell.prototype",
    class: "Cell",
    needsKey: true,
    hasNoDouble: true,
  },
  {
    name: "class-accessor",
    define: () =>
      `class A {\n  a = 1;\n  #k = 2;\n  z = 3;\n  inner = new Inner();\n  get k(): number {\n    note("declared get");\n    return this.#k;\n  }\n  set k(v: number) {\n    note("declared set " + str(v));\n    this.#k = v;\n  }\n  ${methods(true)}\n}\n`,
    make: () => `return new A();`,
    type: "A",
    proto: "A.prototype",
    class: "A",
    needsKey: true,
    hasTypedSetter: true,
  },
  {
    name: "field-on-the-prototype",
    define: () => `interface A {\n  k: number;\n}\nclass A {\n  a = 1;\n  z = 3;\n  inner = new Inner();\n  ${methods(true)}\n}\nA.prototype.k = 2;\n`,
    make: () => `return new A();`,
    type: "A",
    proto: "A.prototype",
    class: "A",
    needsKey: true,
  },
  // What satisfies the type of a class without being an instance of it.
  { name: "proxy-held-as-class", define: hasKey => `class A {\n${fields(hasKey)}  ${methods(hasKey)}\n}\n`, make: () => `return new Proxy(new A(), {});`, type: "A", proto: "A.prototype", class: "A", isProxy: true },
  {
    name: "logging-proxy-held-as-class",
    define: hasKey => `class A {\n${fields(hasKey)}  ${methods(hasKey)}\n}\nconst handler: ProxyHandler<A> = ${loggingHandler};\n`,
    make: () => `return new Proxy(new A(), handler);`,
    type: "A",
    proto: "A.prototype",
    class: "A",
    isProxy: true,
  },
  { name: "literal-held-as-class", define: hasKey => `class A {\n${fields(hasKey)}  ${methods(hasKey)}\n}\n`, make: hasKey => `return ${literal(hasKey)};`, type: "A", class: "A" },
  { name: "structured-clone-held-as-class", define: hasKey => `class A {\n${fields(hasKey)}  ${methods(hasKey)}\n}\n`, make: () => `return structuredClone(new A());`, type: "A", class: "A" },
  { name: "assigned-copy-held-as-class", define: hasKey => `class A {\n${fields(hasKey)}  ${methods(hasKey)}\n}\n`, make: () => `return Object.assign({}, new A());`, type: "A", class: "A" },
  {
    name: "accessor-held-as-field",
    define: shape,
    make: () => `return { a: 1, get k() { note("own get"); return 2; }, set k(v: number) { note("own set " + str(v)); }, z: 3, inner: new Inner(), m() { return "m"; }, double() { return this.k * 2; } };`,
    type: "Shape",
    needsKey: true,
    hasTypedSetter: true,
  },
  { name: "interface-literal", define: shape, make: hasKey => `return ${literal(hasKey)};`, type: "Shape" },
  { name: "interface-class", define: hasKey => `${shape(hasKey)}class A implements Shape {\n${fields(hasKey)}  ${methods(hasKey)}\n}\n`, make: () => `return new A();`, type: "Shape", proto: "A.prototype", class: "A" },
  {
    name: "interface-two-layouts",
    define: hasKey => `${shape(hasKey)}class A implements Shape {\n${reversedFields(hasKey)}  ${methods(hasKey)}\n}\nlet turn = 0;\n`,
    make: hasKey => `return turn++ & 1 ? new A() : ${literal(hasKey)};`,
    type: "Shape",
    class: "A",
  },
  {
    name: "type-alias-literal",
    define: hasKey => `type Shape = { a: number; k${hasKey ? "" : "?"}: number; z: number; inner: Inner; m: () => string; double(): number };\n`,
    make: hasKey => `return { a: 1, ${hasKey ? "k: 2, " : ""}z: 3, inner: new Inner(), m: () => "m", double() { return ${ownNumber(hasKey)} * 2; } };`,
    type: "Shape",
  },
  { name: "inferred-literal", define: () => `type Made = ReturnType<typeof make>;\n`, make: () => `return ${literal(true)};`, type: "Made", isInferred: true, needsKey: true },
  {
    name: "union-of-two-classes",
    define: hasKey => `class A {\n${fields(hasKey)}  ${methods(hasKey)}\n}\nclass Other {\n${reversedFields(hasKey)}  ${methods(hasKey)}\n}\ntype Either = A | Other;\nlet turn = 0;\n`,
    make: () => `return turn++ & 1 ? new Other() : new A();`,
    type: "Either",
    class: "A",
  },
  { name: "array", define: () => "", make: () => `return [10, 20, 30];`, type: "number[]", isArray: true },
  { name: "array-of-doubles", define: () => "", make: () => `return [1.5, 2.5, 3.5];`, type: "number[]", isArray: true },
  { name: "array-of-length", define: () => "", make: () => `return new Array<number>(3);`, type: "number[]", isArray: true },
  { name: "tuple", define: () => "", make: () => `return [10, 20, 30];`, type: "[number, number, number]", isArray: true },
  {
    name: "array-subclass",
    define: () => `class A extends Array<number> {\n  ${method}\n}\n`,
    make: () => `const made = new A();\n  made.push(10, 20, 30);\n  return made;`,
    type: "A",
    proto: "A.prototype",
    class: "A",
    isArray: true,
  },
];

/** What lies above the object under the key before anything runs: a descriptor that is defined on the prototype, or on the prototype above it, once the declarations have run. */
interface Above {
  name: string;
  planted?: string;
  isFar?: boolean;
}

const getterAbove = `{ note("get above"); return "got above"; }`;
const setterAbove = `{ note("set above " + str(v)); }`;
const aboves: Above[] = [
  { name: "nothing-above" },
  { name: "planted-accessor", planted: `{ get() ${getterAbove}, set(v) ${setterAbove}, enumerable: true, configurable: true }` },
  { name: "planted-setter", planted: `{ set(v) ${setterAbove}, configurable: true }` },
  { name: "planted-getter", planted: `{ get() ${getterAbove}, configurable: true }` },
  { name: "planted-read-only", planted: `{ value: "read-only above", writable: false, enumerable: true, configurable: true }` },
  { name: "planted-data", planted: `{ value: "data above", writable: true, enumerable: true, configurable: true }` },
  { name: "planted-far-setter", planted: `{ set(v) ${setterAbove}, configurable: true }`, isFar: true },
  { name: "planted-far-read-only", planted: `{ value: "read-only above", writable: false, enumerable: true, configurable: true }`, isFar: true },
];

type Target = "itself" | "prototype" | "prototype-above";
const targets: Target[] = ["itself", "prototype", "prototype-above"];

interface Site {
  /** The changed object, under the type that the change asks for. */
  object: string;
  key: Key;
  /** The key as an expression: the constant, or the variable `name`. */
  keyText: string;
}

interface Change {
  name: string;
  /** The type under which the change takes the object. Left out: `object`. */
  alias?: (key: Key) => string;
  text: (site: Site) => string;
  /** Declarations in front of everything. */
  before?: string;
  /** The key stands in the text of the change, so it cannot be put together while the program runs. */
  namesKey?: boolean;
  /** The alias requires the key. */
  needsKey?: boolean;
  needsArray?: boolean;
  needsNumber?: boolean;
  /** Under another key a look would print the source text of a function. */
  needsMethod?: boolean;
  needsObject?: boolean;
}

type Descriptor = string | ((key: Key) => string);
const accessor = `get() { note("get"); return "got"; }, set(v) { note("set " + str(v)); }`;
const defines = (name: string, ...descriptors: Descriptor[]): Change => ({
  name,
  text: s => descriptors.map(descriptor => `Object.defineProperty(${s.object}, ${s.keyText}, ${typeof descriptor === "string" ? descriptor : descriptor(s.key)});\n`).join(""),
});
/** A store through the alias that admits the value. */
const stores = (name: string, value: string, fits: (key: Key) => boolean): Change => ({
  name,
  alias: key => (fits(key) ? looseAlias(key) : wideAlias(key)),
  text: s => `${s.key.at(s.object)} = ${value};\n`,
  namesKey: true,
});
const setsPrototype = (name: string, prototype: (s: Site) => string, before?: string): Change => ({ name, text: s => `Object.setPrototypeOf(${s.object}, ${prototype(s)});\n`, before, namesKey: true });
const adds = (count: number): Change => ({ name: `add-${count}`, text: s => `for (let i = 0; i < ${count}; i++) Reflect.set(${s.object}, "p" + i, i);\n` });
const onArray = (name: string, call: string): Change => ({ name, alias: exactAlias, text: s => `${s.object}.${call};\n`, needsArray: true });
const isNumber = (key: Key) => key.type === "number";
const proxyAbove = `new Proxy({}, {
  get(target, key, receiver) { note("above get " + String(key)); return undefined; },
  set(target, key, value, receiver) { note("above set " + String(key)); return Reflect.set(target, key, value, receiver); },
  has(target, key) { note("above has " + String(key)); return false; },
})`;

const changes: Change[] = [
  defines("define-data", `{ value: "defined", writable: true, enumerable: true, configurable: true }`),
  defines("define-same-type", key => `{ value: ${key.sameTypeValue}, writable: true, enumerable: true, configurable: true }`),
  defines("define-read-only", `{ value: "read-only", writable: false, enumerable: true, configurable: true }`),
  defines("define-read-only-same-type", key => `{ value: ${key.sameTypeValue}, writable: false, enumerable: true, configurable: true }`),
  defines("define-hidden", `{ value: "hidden", writable: true, enumerable: false, configurable: true }`),
  defines("define-permanent", `{ value: "permanent", writable: true, enumerable: true, configurable: false }`),
  defines("define-value-alone", `{ value: "bare" }`),
  defines("define-nothing", `{}`),
  defines("switch-off-writable", `{ writable: false }`),
  defines("switch-off-enumerable", `{ enumerable: false }`),
  defines("switch-off-configurable", `{ configurable: false }`),
  defines("switch-off-one-by-one", `{ writable: false }`, `{ enumerable: false }`, `{ configurable: false }`),
  defines("define-accessor", `{ ${accessor}, enumerable: true, configurable: true }`),
  defines("define-accessor-of-same-type", key => `{ get() { note("get"); return ${key.sameTypeValue}; }, set(v) { note("set " + str(v)); }, enumerable: true, configurable: true }`),
  defines("define-getter", `{ get() { note("get"); return "got"; }, enumerable: true, configurable: true }`),
  defines("define-getter-of-same-type", key => `{ get() { note("get"); return ${key.sameTypeValue}; }, enumerable: true, configurable: true }`),
  defines("define-setter", `{ set(v) { note("set " + str(v)); }, enumerable: true, configurable: true }`),
  defines("define-hidden-accessor", `{ ${accessor}, enumerable: false, configurable: true }`),
  defines("define-accessor-that-throws", `{ get() { note("get"); throw new RangeError("get"); }, set(v) { note("set"); throw new RangeError("set"); }, enumerable: true, configurable: true }`),
  defines("accessor-then-data", `{ ${accessor}, enumerable: true, configurable: true }`, `{ value: "data", writable: true }`),
  defines("data-then-accessor", `{ value: "data", writable: true, enumerable: true, configurable: true }`, `{ ${accessor} }`),
  { name: "reflect-define", text: s => `note("defined " + Reflect.defineProperty(${s.object}, ${s.keyText}, { value: "reflected", writable: false, enumerable: true, configurable: false }));\nnote("again " + Reflect.defineProperty(${s.object}, ${s.keyText}, { value: "other" }));\n` },
  { name: "define-properties", text: s => `Object.defineProperties(${s.object}, { extra: { value: 1, enumerable: true }, ${s.key.inLiteral}: { ${accessor}, enumerable: true, configurable: true } });\n`, namesKey: true },

  { name: "delete", alias: looseAlias, text: s => `note("deleted " + delete ${s.key.at(s.object)});\n`, namesKey: true },
  { name: "delete-twice", alias: looseAlias, text: s => `note("deleted " + delete ${s.key.at(s.object)});\nnote("deleted " + delete ${s.key.at(s.object)});\n`, namesKey: true },
  { name: "delete-and-store", alias: looseAlias, text: s => `delete ${s.key.at(s.object)};\n${s.key.at(s.object)} = ${s.key.sameTypeValue};\n`, namesKey: true },
  { name: "reflect-delete", text: s => `note("deleted " + Reflect.deleteProperty(${s.object}, ${s.keyText}));\n` },

  stores("store-number", `9`, isNumber),
  stores("store-double", `9.5`, isNumber),
  stores("store-undefined", `undefined`, () => true),
  stores("store-text", `"stored"`, () => false),
  stores("store-null", `null`, () => false),
  stores("store-object", `{ inner: 1 }`, () => false),
  { ...stores("store-function", `function () { return "stored function"; }`, () => true), needsMethod: true },
  stores("store-big-integer", `9n`, () => false),
  // Other layouts that satisfy the declared class.
  { ...stores("store-literal-of-the-type", `{ w() { return 70; }, v: 7 }`, () => true), needsObject: true },
  { ...stores("store-proxy-of-the-type", `new Proxy(new Inner(), {})`, () => true), needsObject: true },
  { ...stores("store-instance-of-another-class", `new OtherInner()`, () => false), needsObject: true },
  { name: "change-the-object-it-holds", alias: exactAlias, text: s => `Object.defineProperty(${s.key.at(s.object)}, "v", { get() { note("get v"); return 8; }, configurable: true });\n`, namesKey: true, needsObject: true },
  { name: "increment", alias: exactAlias, text: s => `${s.key.at(s.object)}++;\n`, namesKey: true, needsKey: true, needsNumber: true },

  { name: "freeze", text: s => `Object.freeze(${s.object});\n` },
  { name: "seal", text: s => `Object.seal(${s.object});\n` },
  { name: "prevent-extensions", text: s => `Object.preventExtensions(${s.object});\n` },
  { name: "reflect-prevent-extensions", text: s => `note("prevented " + Reflect.preventExtensions(${s.object}));\n` },
  { name: "accessor-then-freeze", text: s => `Object.defineProperty(${s.object}, ${s.keyText}, { ${accessor}, enumerable: true, configurable: true });\nObject.freeze(${s.object});\n` },

  setsPrototype("prototype-to-null", () => `null`),
  setsPrototype("prototype-to-empty", () => `{}`),
  setsPrototype("prototype-to-data", s => (s.key.isMethod ? `{ m() { return "other m"; } }` : `{ ${s.key.inLiteral}: "inherited", m() { return "other m"; } }`)),
  setsPrototype("prototype-to-accessor", s => `{ get ${s.key.inLiteral}() { note("get above"); return "got above"; }, set ${s.key.inLiteral}(v: unknown) { note("set above " + str(v)); } }`),
  setsPrototype("prototype-to-getter", s => `{ get ${s.key.inLiteral}() { note("get above"); return "got above"; } }`),
  setsPrototype("prototype-to-read-only", s => `Object.freeze({ ${s.key.inLiteral}: "frozen above" })`),
  setsPrototype("prototype-to-proxy", () => proxyAbove),
  setsPrototype("prototype-to-its-heir", s => `Object.create(${s.object})`),
  setsPrototype("prototype-to-another-class", () => `Stranger.prototype`, `class Stranger {\n  m(): string {\n    return "m of a stranger";\n  }\n}\n`),
  { name: "prototype-by-reflect", text: s => `note("set " + Reflect.setPrototypeOf(${s.object}, { set ${s.key.inLiteral}(v: unknown) { note("set above " + str(v)); } }));\n`, namesKey: true },
  { name: "prototype-away-and-back", text: s => `const kept: object | null = Object.getPrototypeOf(${s.object});\nObject.setPrototypeOf(${s.object}, null);\nObject.setPrototypeOf(${s.object}, kept);\n` },

  adds(1),
  adds(7),
  adds(65),
  adds(1025),
  { name: "assign", text: s => `Object.assign(${s.object}, { early: 1, ${s.key.inLiteral}: "assigned", late: 2 });\n`, namesKey: true },
  { name: "assign-same-type", text: s => `Object.assign(${s.object}, { ${s.key.inLiteral}: ${s.key.sameTypeValue} });\n`, namesKey: true },
  { name: "assign-undefined", text: s => `const given: { ${s.key.inLiteral}?: ${s.key.type} } = { ${s.key.inLiteral}: undefined };\nObject.assign(${s.object}, given);\n`, namesKey: true },
  { name: "assign-from-getter", text: s => `Object.assign(${s.object}, { get ${s.key.inLiteral}() { note("source get"); return "from getter"; } });\n`, namesKey: true },
  { name: "reflect-set", text: s => `note("set " + Reflect.set(${s.object}, ${s.keyText}, "reflected"));\n` },
  { name: "reflect-set-same-type", text: s => `note("set " + Reflect.set(${s.object}, ${s.keyText}, ${s.key.sameTypeValue}));\n` },
  { name: "reflect-set-as-receiver", text: s => `note("set " + Reflect.set({}, ${s.keyText}, "reflected", ${s.object}));\n` },
  { name: "reflect-set-for-another-receiver", text: s => `const receiver = {};\nnote("set " + Reflect.set(${s.object}, ${s.keyText}, "reflected", receiver));\nnote("receiver has " + Reflect.ownKeys(receiver).length);\n` },

  { name: "length-to-zero", alias: exactAlias, text: s => `${s.object}.length = 0;\n`, needsArray: true },
  { name: "length-shrinks", alias: exactAlias, text: s => `${s.object}.length = 1;\n`, needsArray: true },
  { name: "length-grows", alias: exactAlias, text: s => `${s.object}.length = 9;\n`, needsArray: true },
  { name: "length-read-only", text: s => `Object.defineProperty(${s.object}, "length", { writable: false });\n`, needsArray: true },
  { name: "make-hole", alias: looseAlias, text: s => `delete ${s.object}[1];\n`, needsArray: true },
  { name: "store-past-the-end", alias: exactAlias, text: s => `${s.object}[5] = 50;\n`, needsArray: true },
  { name: "store-far-past-the-end", alias: exactAlias, text: s => `${s.object}[100000] = 50;\n`, needsArray: true },
  { name: "element-of-another-kind", alias: wideAlias, text: s => `${s.object}[1] = "text";\n`, needsArray: true },
  { name: "element-double", alias: exactAlias, text: s => `${s.object}[1] = 0.5;\n`, needsArray: true },
  { name: "push-of-another-kind", alias: wideAlias, text: s => `${s.object}.push("text");\n`, needsArray: true },
  onArray("push", "push(40)"),
  onArray("pop", "pop()"),
  onArray("shift", "shift()"),
  onArray("unshift", "unshift(5)"),
  onArray("splice", "splice(1, 1)"),
  onArray("reverse", "reverse()"),
  onArray("fill", "fill(0)"),
  onArray("copy-within", "copyWithin(0, 1)"),
  onArray("sort", "sort((p, q) => q - p)"),
];

interface LookSite {
  /** The typed reference. */
  object: string;
  key: Key;
  /** The type requires the key. */
  isRequired: boolean;
  holder: Holder;
}

interface Look {
  name: string;
  /** Statements that leave what they saw in `seen`. */
  text: (site: LookSite) => string;
  before?: string;
  helpers?: string[];
  needsNumber?: boolean;
  needsMethod?: boolean;
  needsRequiredKey?: boolean;
  needsWritableKey?: boolean;
  needsClass?: boolean;
  needsArray?: boolean;
  refusesArray?: boolean;
  needsDouble?: boolean;
  needsObject?: boolean;
}

/** The property as a number, whether or not the type requires it. */
const asNumber = (s: LookSite) => (s.isRequired ? s.key.at(s.object) : `(${s.key.at(s.object)} ?? 0)`);

const looks: Look[] = [
  // Looks that read.
  { name: "read", text: s => `seen = str(${s.key.at(s.object)});\n` },
  { name: "read-twice", text: s => `seen = str(${s.key.at(s.object)}) + " " + str(${s.key.at(s.object)});\n` },
  { name: "type-of", text: s => `seen = typeof ${s.key.at(s.object)};\n` },
  { name: "add-one", text: s => `seen = str(${asNumber(s)} + 1);\n`, needsNumber: true },
  { name: "to-fixed", text: s => (s.isRequired ? `seen = ${s.key.at(s.object)}.toFixed(1);\n` : `seen = str(${s.key.at(s.object)}?.toFixed(1));\n`), needsNumber: true },
  { name: "passed-to-typed-function", before: `function twice(n: number): number {\n  return n * 2;\n}\n`, text: s => `seen = str(twice(${asNumber(s)}));\n`, needsNumber: true },
  { name: "compared", text: s => `seen = str(${s.key.at(s.object)} === 2) + " " + str(${s.key.at(s.object)} > 1);\n`, needsNumber: true, needsRequiredKey: true },
  { name: "summed-in-a-loop", text: s => `let sum = 0;\nfor (let i = 0; i < 100; i++) sum += ${asNumber(s)};\nseen = str(sum);\n`, needsNumber: true },
  { name: "read-in-template", text: s => `seen = \`\${${s.key.at(s.object)}}\`;\n`, needsNumber: true },
  { name: "destructure", text: s => `const { ${s.key.inLiteral}: taken = -1 } = ${s.object};\nseen = str(taken);\n`, needsNumber: true, refusesArray: true },
  { name: "call-method", text: s => `seen = str(${s.object}.m());\n`, refusesArray: true },
  { name: "method-reads-field", text: s => `seen = str(${s.object}.double());\n`, needsNumber: true, needsDouble: true },
  { name: "field-of-the-object-it-holds", text: s => `seen = str(${s.key.at(s.object)}.v + 1);\n`, needsObject: true },
  { name: "method-of-the-object-it-holds", text: s => `seen = str(${s.key.at(s.object)}.w());\n`, needsObject: true },
  { name: "field-of-the-object-it-holds-in-a-loop", text: s => `let sum = 0;\nfor (let i = 0; i < 100; i++) sum += ${s.key.at(s.object)}.v;\nseen = str(sum);\n`, needsObject: true },
  { name: "method-compared-with-itself", text: s => `const taken = ${s.object}.m;\nseen = str(taken === ${s.object}.m) + " " + str(${s.object}.m === ${s.object}.m);\n`, refusesArray: true },
  { name: "method-taken-off", text: s => `const taken = ${s.key.at(s.object)};\nseen = str(taken());\n`, needsMethod: true },
  { name: "in", text: s => `seen = str(${s.key.constant} in ${s.object});\n` },
  { name: "has-own", text: s => `seen = str(Object.hasOwn(${s.object}, ${s.key.constant}));\n` },
  { name: "keys", text: s => `seen = listed(Object.keys(${s.object}));\n`, helpers: ["listed"] },
  { name: "for-in", text: s => `const found: string[] = [];\nfor (const key in ${s.object}) found.push(key);\nseen = listed(found);\n`, helpers: ["listed"] },
  { name: "json", text: s => `seen = shortened(str(JSON.stringify(${s.object})));\n`, helpers: ["listed"] },
  { name: "spread", text: s => `seen = contents({ ...${s.object} });\n`, helpers: ["listed", "contents"] },
  { name: "descriptor", text: s => `seen = described(Object.getOwnPropertyDescriptor(${s.object}, ${s.key.constant}));\n`, helpers: ["described"] },
  { name: "integrity", text: s => `seen = Object.isFrozen(${s.object}) + " " + Object.isSealed(${s.object}) + " " + Object.isExtensible(${s.object});\n` },
  { name: "instance-of", text: s => `seen = str(${s.object} instanceof ${s.holder.class});\n`, needsClass: true },
  { name: "neighbors", text: s => `seen = str(${s.object}.a) + " " + str(${s.object}.z);\n`, refusesArray: true },
  { name: "length", text: s => `seen = str(${s.object}.length);\n`, needsArray: true },
  { name: "elements", text: s => `const found: string[] = [];\nfor (let i = 0; i < ${s.object}.length && i < 12; i++) found.push(str(${s.object}[i]));\nseen = listed(found);\n`, helpers: ["listed"], needsArray: true },
  { name: "sum-of-elements", text: s => `let sum = 0;\nfor (const element of ${s.object}) sum += element;\nseen = str(sum);\n`, needsArray: true },
  { name: "sum-by-index", text: s => `let sum = 0;\nfor (let i = 0; i < ${s.object}.length && i < 12; i++) sum += ${s.object}[i];\nseen = str(sum);\n`, needsArray: true },
  { name: "join", text: s => `seen = shortened(${s.object}.join());\n`, helpers: ["listed"], needsArray: true },

  // Looks that read nothing: only an effect tells.
  { name: "store", text: s => `${s.key.at(s.object)} = ${s.key.storedValue};\nseen = "stored";\n`, needsWritableKey: true },
  { name: "store-twice", text: s => `${s.key.at(s.object)} = 5;\n${s.key.at(s.object)} = 6;\nseen = "stored";\n`, needsNumber: true, needsWritableKey: true },
  { name: "store-neighbor", text: s => `${s.object}.z = 5;\nseen = "stored";\n`, refusesArray: true },
  { name: "increment", text: s => `${s.key.at(s.object)}++;\nseen = "incremented";\n`, needsNumber: true, needsRequiredKey: true, needsWritableKey: true },
  { name: "read-unused", text: s => `${s.key.at(s.object)};\nseen = "read";\n` },
  { name: "make-another", text: () => `make();\nseen = "made";\n` },
  { name: "push", text: s => `seen = "pushed " + ${s.object}.push(40);\n`, needsArray: true },
  { name: "pop", text: s => `${s.object}.pop();\nseen = "popped";\n`, needsArray: true },
];

interface Parts {
  /** The declared type of the object. */
  type: string;
  make: string;
  /** What is changed, given the variable that holds the object. */
  subject: (object: string) => string;
  /** The change of the given object. An exception is noted. */
  change: (subject: string) => string;
  /** Leaves what a look through the reference saw, with the effects it had, in `line`. */
  observe: (reference: string) => string;
  /** Looks and prints. `label` is an expression. */
  look: (reference: string, label: string) => string;
}

interface Place {
  name: string;
  text: (parts: Parts) => string;
  /** The change runs before there is an object. */
  needsOtherTarget?: boolean;
}

const locals = `let seen = "";\nlet before = 0;\nlet line = "";\n`;
const reportFailure = `print("run threw " + kindOf(e));\n`;
const inFunction = (body: string, isAsync = false) =>
  `${isAsync ? "async function run(): Promise<void>" : "function run(): void"} {\n${locals}${body}}\n${isAsync ? `run().then(undefined, (e: unknown) => {\n${reportFailure}});\n` : `try {\nrun();\n} catch (e) {\n${reportFailure}}\n`}`;
/** The object is made, `setup` puts the typed reference somewhere, and the object is looked at through `reference` before and after `between`, which is the change unless it is given. */
const held = (p: Parts, reference: string, setup = "", between = p.change(p.subject("o"))) => `const o: ${p.type} = ${p.make};\n${setup}${p.look(reference, `"before"`)}${between}${p.look(reference, `"after"`)}`;
const printWhenItDiffers = `if (line !== last || i === 150) {\nprint(i + ": " + line);\nlast = line;\n}\n`;
const once = (body: string) => `if (!isDone) {\nisDone = true;\n${body}}\n`;

/** Something that runs statements once, which name `o`. */
interface Trigger {
  name: string;
  text: (body: string) => string;
  isAsync?: boolean;
}

const triggers: Trigger[] = [
  { name: "in-closure", text: body => `const later = (): void => {\n${body}};\nlater();\n` },
  { name: "in-for-each", text: body => `[0].forEach(() => {\n${body}});\n` },
  { name: "in-sort", text: body => `let isDone = false;\n[2, 1].sort((p, q) => {\n${once(body)}return p - q;\n});\n` },
  { name: "in-replace", text: body => `"x".replace("x", () => {\n${body}return "y";\n});\n` },
  { name: "in-reviver", text: body => `JSON.parse("1", (key, value) => {\n${body}return value;\n});\n` },
  { name: "in-to-json", text: body => `JSON.stringify({ toJSON() {\n${body}return 1;\n} });\n` },
  { name: "in-getter-run-by-assign", text: body => `Object.assign({}, { get trigger() {\n${body}return 1;\n} });\n` },
  { name: "in-getter", text: body => `const trigger = { get fire() {\n${body}return 1;\n} };\ntrigger.fire;\n` },
  { name: "in-setter", text: body => `const trigger = { set fire(v: number) {\n${body}} };\ntrigger.fire = 1;\n` },
  { name: "in-value-of", text: body => `const trigger = { valueOf() {\n${body}return 1;\n} };\nNumber(trigger);\n` },
  { name: "in-to-string", text: body => `const trigger = { toString() {\n${body}return "";\n} };\n\`\${trigger}\`;\n` },
  { name: "in-finally", text: body => `try {\nnote("tried");\n} finally {\n${body}}\n` },
  { name: "in-catch", text: body => `try {\nthrow new Error("thrown");\n} catch {\n${body}}\n` },
  { name: "in-constructor", text: body => `new (class {\nconstructor() {\n${body}}\n})();\n` },
  { name: "in-map-for-each", text: body => `new Map([[1, 1]]).forEach(() => {\n${body}});\n` },
  { name: "in-generator-step", text: body => `(function* () {\n${body}yield 1;\n})().next();\n` },
  { name: "after-await", text: body => `await null;\n${body}`, isAsync: true },
  { name: "in-then", text: body => `await Promise.resolve().then(() => {\n${body}});\n`, isAsync: true },
  { name: "in-another-task", text: body => `const other = (async () => {\nawait null;\n${body}})();\nawait other;\n`, isAsync: true },
];

const places: Place[] = [
  { name: "before-first-use", text: p => inFunction(`const o: ${p.type} = ${p.make};\n${p.change(p.subject("o"))}${p.look("o", `"after"`)}`) },
  { name: "before-first-instance", text: p => inFunction(`${p.change(p.subject("o"))}const o: ${p.type} = ${p.make};\n${p.look("o", `"after"`)}`), needsOtherTarget: true },
  { name: "between-uses", text: p => inFunction(held(p, "o")) },
  {
    name: "between-instances",
    text: p =>
      inFunction(`const first: ${p.type} = ${p.make};\n${p.look("first", `"first before"`)}${p.change(p.subject("first"))}const second: ${p.type} = ${p.make};\n${p.look("second", `"second"`)}${p.look("first", `"first after"`)}`),
  },
  { name: "held-in-second-variable", text: p => inFunction(held(p, "kept", `const kept: ${p.type} = o;\n`)) },
  { name: "held-in-field", text: p => inFunction(held(p, "box.held", `const box: { held: ${p.type} } = { held: o };\n`)) },
  {
    name: "held-in-class-field",
    text: p => `class Box {\n  held: ${p.type};\n  constructor(held: ${p.type}) {\n    this.held = held;\n  }\n}\n${inFunction(held(p, "box.held", `const box = new Box(o);\n`))}`,
  },
  {
    name: "held-in-private-field",
    text: p => `class Box {\n  #held: ${p.type};\n  constructor(held: ${p.type}) {\n    this.#held = held;\n  }\n  take(): ${p.type} {\n    return this.#held;\n  }\n}\n${inFunction(held(p, "box.take()", `const box = new Box(o);\n`))}`,
  },
  { name: "held-in-element", text: p => inFunction(held(p, "list[0]", `const list: Array<${p.type}> = [o];\n`)) },
  {
    name: "held-in-map",
    text: p => {
      const lookAt = (label: string) => `{\nconst got = table.get("held");\nif (got !== undefined) {\n${p.look("got", label)}}\n}\n`;
      return inFunction(`const o: ${p.type} = ${p.make};\nconst table = new Map<string, ${p.type}>();\ntable.set("held", o);\n${lookAt(`"before"`)}${p.change(p.subject("o"))}${lookAt(`"after"`)}`);
    },
  },
  {
    name: "held-in-captured-variable",
    text: p => inFunction(`const o: ${p.type} = ${p.make};\nconst peek = (label: string): void => {\n${locals}${p.look("o", "label")}};\npeek("before");\n${p.change(p.subject("o"))}peek("after");\n`),
  },
  {
    name: "look-in-callee",
    text: p => `function report(x: ${p.type}, label: string): void {\n${locals}${p.look("x", "label")}}\n${inFunction(`const o: ${p.type} = ${p.make};\nreport(o, "before");\n${p.change(p.subject("o"))}report(o, "after");\n`)}`,
  },
  {
    name: "held-in-this",
    text: p =>
      `class Watcher {\n  held: ${p.type};\n  constructor(held: ${p.type}) {\n    this.held = held;\n  }\n  report(label: string): void {\n${locals}${p.look("this.held", "label")}  }\n}\n${inFunction(`const o: ${p.type} = ${p.make};\nconst watcher = new Watcher(o);\nwatcher.report("before");\n${p.change(p.subject("o"))}watcher.report("after");\n`)}`,
  },
  {
    name: "held-in-module-variable",
    text: p => `const shared: ${p.type} = ${p.make};\nfunction report(label: string): void {\n${locals}${p.look("shared", "label")}}\n${inFunction(`report("before");\n${p.change(p.subject("shared"))}report("after");\n`)}`,
  },
  {
    name: "held-in-narrowed-union",
    text: p => inFunction(`const maybe: ${p.type} | null = count >= 0 ? ${p.make} : null;\nif (maybe !== null) {\n${p.look("maybe", `"before"`)}${p.change(p.subject("maybe"))}${p.look("maybe", `"after"`)}}\n`),
  },
  {
    name: "one-of-many",
    text: p => inFunction(`const all: Array<${p.type}> = [];\nfor (let i = 0; i < 6; i++) all.push(${p.make});\n${p.change(p.subject("all[3]"))}for (let i = 0; i < 6; i++) {\nconst o = all[i];\n${p.look("o", `"object " + i`)}}\n`),
  },
  { name: "on-one-path", text: p => inFunction(`for (let i = 0; i < 4; i++) {\nconst o: ${p.type} = ${p.make};\nif (i & 1) {\n${p.change(p.subject("o"))}}\n${p.look("o", `"round " + i`)}}\n`) },
  {
    name: "at-iteration",
    text: p => inFunction(`const o: ${p.type} = ${p.make};\nlet last = "";\nfor (let i = 0; i < 300; i++) {\nif (i === 150) {\n${p.change(p.subject("o"))}}\n${p.observe("o")}${printWhenItDiffers}}\n`),
  },
  {
    name: "parameter-in-a-hot-loop",
    text: p =>
      `let last = "";\nfunction visit(x: ${p.type}, i: number): void {\n${locals}${p.observe("x")}${printWhenItDiffers}}\n${inFunction(`const o: ${p.type} = ${p.make};\nfor (let i = 0; i < 300; i++) {\nif (i === 150) {\n${p.change(p.subject("o"))}}\nvisit(o, i);\n}\n`)}`,
  },
  {
    name: "at-iteration-over-many",
    text: p =>
      inFunction(`const all: Array<${p.type}> = [];\nfor (let i = 0; i < 8; i++) all.push(${p.make});\nlet last = "";\nfor (let i = 0; i < 300; i++) {\nconst o = all[i & 7];\nif (i === 150) {\n${p.change(p.subject("o"))}}\n${p.observe("o")}${printWhenItDiffers}}\n`),
  },
  {
    name: "between-yields",
    text: p =>
      `function* steps(x: ${p.type}): Generator<number, void, unknown> {\n${locals}${p.look("x", `"before"`)}yield 1;\n${p.look("x", `"after"`)}}\n${inFunction(`const o: ${p.type} = ${p.make};\nconst walk = steps(o);\nwalk.next();\n${p.change(p.subject("o"))}walk.next();\n`)}`,
  },
  {
    name: "while-awaiting",
    text: p =>
      `let release: () => void = () => {};\nconst gate = new Promise<void>(resolve => {\n  release = resolve;\n});\n${inFunction(`const o: ${p.type} = ${p.make};\nPromise.resolve().then(() => {\n${p.change(p.subject("o"))}release();\n});\n${p.look("o", `"before"`)}await gate;\n${p.look("o", `"after"`)}`, true)}`,
  },
  ...triggers.map((trigger): Place => ({ name: trigger.name, text: p => inFunction(held(p, "o", "", trigger.text(p.change(p.subject("o")))), trigger.isAsync) })),
];

const helperTexts: Record<string, string> = {
  listed: `function shortened(text: string): string {
  if (text.length <= 400) return text;
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return text.slice(0, 150) + " .. " + text.length + " characters, sum " + sum + " .. " + text.slice(-150);
}
function listed(items: readonly string[]): string {
  let text = "";
  for (let i = 0; i < items.length; i++) text += (i ? "," : "") + items[i];
  return shortened(items.length + " [" + text + "]");
}
`,
  contents: `function contents(copy: object): string {
  const found: string[] = [];
  for (const key of Reflect.ownKeys(copy)) found.push(String(key) + "=" + str(Reflect.get(copy, key)));
  return listed(found);
}
`,
  described: `function described(descriptor: PropertyDescriptor | undefined): string {
  if (descriptor === undefined) return "none";
  const kind = "value" in descriptor ? "value " + str(descriptor.value) + (descriptor.writable ? " writable" : "") : "accessor" + (descriptor.get ? " get" : "") + (descriptor.set ? " set" : "");
  return kind + (descriptor.enumerable ? " enumerable" : "") + (descriptor.configurable ? " configurable" : "");
}
`,
};

const prelude = `const print = (text: string): void => console.log(text);
let count = 0;
let trail = "";
function note(text: string): void {
  count++;
  trail += text + "; ";
}
function str(v: unknown): string {
  if (typeof v === "string") return '"' + v + '"';
  if (typeof v === "function") return "function";
  if (typeof v === "symbol") return "symbol";
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "object" && v !== null) return "object";
  if (v === 0 && 1 / v < 0) return "-0";
  return String(v);
}
function kindOf(e: unknown): string {
  return e instanceof Error ? e.name : "not an error";
}
`;
const innerClasses = `class Inner {
  v = 1;
  w(): number {
    return this.v * 3;
  }
}
class DeepInner extends Inner {
  deep = 5;
  w(): number {
    return 99;
  }
}
class OtherInner {
  extra = "first";
  v = "text";
  w(): string {
    return "other";
  }
}
`;
const spellers = `function spell(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) result += text[i];
  return result;
}
function tally(limit: number): number {
  let result = 0;
  while (result < limit) result++;
  return result;
}
`;

export interface Combination {
  holder: Holder;
  above: Above;
  target: Target;
  change: Change;
  key: Key;
  /** The object has `k` from its creation on, and its type requires it. */
  isOwn: boolean;
  /** How the change spells the key. A look names it. */
  spelling: Spelling;
  place: Place;
  /** The change stands in a function that takes the object under the type the change asks for. */
  isChangedInCallee: boolean;
  look: Look;
}

function isPossible({ holder, above, target, change, key, isOwn, spelling, place, look }: Combination): boolean {
  if (!!holder.isArray !== !!key.isIndex) return false;
  // Only `k` can be left out.
  if (key.name === "k" ? !isOwn && holder.needsKey : isOwn) return false;
  const isRequired = key.name !== "k" || isOwn;
  if (above.planted && !(above.isFar ? holder.grand : holder.proto)) return false;
  if (target === "prototype" && !holder.proto) return false;
  if (target === "prototype-above" && !holder.grand) return false;
  if (place.needsOtherTarget && target === "itself") return false;
  if (change.needsArray && !(holder.isArray && target === "itself")) return false;
  if (change.needsNumber && key.type !== "number") return false;
  if (change.needsObject && !key.isObject) return false;
  // A proxy may become its own ancestor, and every lookup then ends in a stack overflow at a depth of its own.
  if (change.name === "prototype-to-its-heir" && holder.isProxy) return false;
  if (change.needsMethod && !key.isMethod) return false;
  if (change.needsKey && !isRequired) return false;
  if (change.namesKey && spelling === "computed") return false;
  if (look.needsArray && !holder.isArray) return false;
  if (look.refusesArray && holder.isArray) return false;
  if (look.needsNumber && key.type !== "number") return false;
  if (look.needsObject && !key.isObject) return false;
  if (look.needsMethod && !key.isMethod) return false;
  if (look.needsRequiredKey && !isRequired) return false;
  if (look.needsWritableKey && holder.isKeyReadOnly && key.name === "k") return false;
  if (look.needsClass && !holder.class) return false;
  if (look.needsDouble && (holder.isArray || holder.hasNoDouble)) return false;
  return true;
}

const guarded = (body: string, handler: string) => `try {\n${body}} catch (e) {\n${handler}}\n`;

/** The statements of the program. They can stand in a function. */
export function bodyOf(combination: Combination): string {
  const { holder, above, target, change, key, isOwn, spelling, place, isChangedInCallee, look } = combination;
  const hasKey = key.name !== "k" || isOwn;
  const keyText = spelling === "computed" ? "name" : key.constant;
  const alias = change.alias?.(key);
  const noteFailure = `note("the change THROWS " + kindOf(e));\n`;
  const observe = (reference: string) =>
    `before = count;\n${guarded(look.text({ object: reference, key, isRequired: hasKey, holder }), `seen = "THROWS " + kindOf(e);\n`)}line = seen + " | " + (count - before) + " " + trail;\ntrail = "";\n`;
  const parts: Parts = {
    type: holder.type,
    make: "make()",
    subject: object => (target === "itself" ? object : target === "prototype" ? holder.proto! : holder.grand!),
    change: subject =>
      isChangedInCallee ? `change(${subject});\n` : guarded(alias ? `const changed: ${alias} = ${subject};\n${change.text({ object: "changed", key, keyText })}` : change.text({ object: subject, key, keyText }), noteFailure),
    observe,
    look: (reference, label) => `${observe(reference)}print(${label} + ": " + line);\n`,
  };
  return [
    prelude,
    [...new Set(look.helpers ?? [])].map(name => helperTexts[name]).join(""),
    spelling === "computed" ? `${spellers}const name: ${key.computedType} = ${key.computed};\n` : "",
    holder.isArray ? "" : innerClasses,
    holder.define(hasKey),
    `function make()${holder.isInferred ? "" : `: ${holder.type}`} {\n  ${holder.make(hasKey)}\n}\n`,
    above.planted ? `Object.defineProperty(${above.isFar ? holder.grand : holder.proto}, ${key.constant}, ${above.planted});\n` : "",
    change.before ?? "",
    isChangedInCallee ? `function change(x: ${alias ?? "object"}): void {\n${guarded(change.text({ object: "x", key, keyText }), noteFailure)}}\n` : "",
    look.before ?? "",
    place.text(parts),
    `print("end: " + trail);\n`,
  ].join("");
}

/** The program: a module, so that its declarations are its own. */
export const textOf = (combination: Combination) => `${bodyOf(combination)}export {};\n`;

export const nameOf = ({ holder, above, target, change, key, isOwn, spelling, place, isChangedInCallee, look }: Combination) =>
  `${holder.name}.${above.name}.${target}.${change.name}.${key.name}${isOwn ? "+own" : ""}.${spelling}-constant.${place.name}${isChangedInCallee ? "+callee" : ""}.${look.name}`;

export const tsconfig = JSON.stringify({ compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", noEmit: true, strict: true, types: [] } });

export interface Axes {
  holders: Holder[];
  aboves: Above[];
  targets: Target[];
  changes: Change[];
  keys: Key[];
  presences: boolean[];
  spellings: Spelling[];
  places: Place[];
  callees: boolean[];
  looks: Look[];
}

export const allAxes: Axes = { holders, aboves, targets, changes, keys, presences: [true, false], spellings: ["constant", "computed"], places, callees: [false, true], looks };

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
    aboves: chosen(aboves, names.aboves),
    targets: names.targets ? targets.filter(target => names.targets!.includes(target)) : targets,
    changes: chosen(changes, names.changes),
    keys: chosen(keys, names.keys),
    presences: names.presences ? [true, false].filter(isOwn => names.presences!.includes(isOwn ? "own" : "absent")) : [true, false],
    spellings: names.spellings ? allAxes.spellings.filter(spelling => names.spellings!.includes(spelling)) : allAxes.spellings,
    places: chosen(places, names.places),
    callees: names.callees ? [false, true].filter(isChangedInCallee => names.callees!.includes(isChangedInCallee ? "callee" : "inline")) : [false, true],
    looks: chosen(looks, names.looks),
  };
}

export const sizeOf = (axes: Axes) => Object.values(axes).reduce((product, axis) => product * axis.length, 1);

export function* combinations(axes: Axes = allAxes): Generator<Combination> {
  for (const holder of axes.holders)
    for (const above of axes.aboves)
      for (const target of axes.targets)
        for (const change of axes.changes)
          for (const key of axes.keys)
            for (const isOwn of axes.presences)
              for (const spelling of axes.spellings)
                for (const place of axes.places)
                  for (const isChangedInCallee of axes.callees)
                    for (const look of axes.looks) {
                      const combination = { holder, above, target, change, key, isOwn, spelling, place, isChangedInCallee, look };
                      if (isPossible(combination)) yield combination;
                    }
}

/** The combination that `nameOf` gives the name. */
export function combinationOf(name: string): Combination {
  const [holder, above, target, change, key, spelling, place, look] = name.split(".");
  const [keyName, presence = "absent"] = key.split("+");
  const [placeName, callee = "inline"] = place.split("+");
  const axes = axesOf({ holders: [holder], aboves: [above], targets: [target], changes: [change], keys: [keyName], presences: [presence], spellings: [spelling.split("-")[0]], places: [placeName], callees: [callee], looks: [look] });
  const [combination] = combinations(axes);
  if (!combination) throw new Error(`no such combination: ${name}`);
  return combination;
}

/** One combination, drawn with `pick`. */
export function pickCombination(pick: <T>(items: readonly T[]) => T, axes: Axes = allAxes): Combination {
  for (;;) {
    const combination = {
      holder: pick(axes.holders),
      // Two of three objects have nothing above them under the key, and two of three changes are made to the object itself.
      above: axes.aboves.includes(aboves[0]) && pick([0, 1, 2]) ? aboves[0] : pick(axes.aboves),
      target: axes.targets.includes("itself") && pick([0, 1, 2]) ? ("itself" as const) : pick(axes.targets),
      change: pick(axes.changes),
      key: pick(axes.keys),
      isOwn: pick(axes.presences),
      spelling: pick(axes.spellings),
      place: pick(axes.places),
      isChangedInCallee: pick(axes.callees),
      look: pick(axes.looks),
    };
    if (isPossible(combination)) return combination;
  }
}

/** Programs with many combinations each, every combination in a function of its own. */
export function programsBy(group: (combination: Combination) => string, axes: Axes): { name: string; text: string }[] {
  const groups = Map.groupBy(combinations(axes), group);
  return [...groups].map(([name, members]) => ({
    name,
    text: members.map(combination => `console.log(${JSON.stringify("## " + nameOf(combination))});\n(() => {\n${bodyOf(combination)}})();\n`).join("") + "export {};\n",
  }));
}

export interface Plane {
  title: string;
  /** The programs that run in every run of the test. */
  alwaysRun: string[];
  /** Some of its changes put a value of another type under the key. */
  programs: { name: string; text: string }[];
}

/** The part of the table that ../generated-typed-object-mutations.test.ts runs. */
export function testPlanes(): Plane[] {
  const byHolder = ({ holder }: Combination) => holder.name;
  const objects = holders.filter(holder => !holder.isArray).map(holder => holder.name);
  // Where a setter refuses the value, the object is not changed, and every line that follows differs.
  const objectsWithoutSetter = holders.filter(holder => !holder.isArray && !holder.hasTypedSetter).map(holder => holder.name);
  const arrays = holders.filter(holder => holder.isArray && holder.name !== "array-of-length").map(holder => holder.name);
  const references = ["between-uses", "held-in-field", "held-in-element", "held-in-captured-variable", "parameter-in-a-hot-loop"];
  const once = { aboves: ["nothing-above"], targets: ["itself"], spellings: ["constant"], callees: ["inline"] };
  return [
    {
      title: "a field declared as a number keeps its type and changes in every other way",
      alwaysRun: ["class-fields", "interface-two-layouts"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: objects,
          changes: ["define-same-type", "define-read-only-same-type", "define-accessor-of-same-type", "define-getter-of-same-type", "switch-off-writable", "switch-off-enumerable", "delete-and-store", "store-double", "freeze", "seal", "add-65", "prototype-to-null"],
          keys: ["k"],
          presences: ["own"],
          places: references,
          looks: ["add-one", "store"],
        }),
      ),
    },
    {
      title: "a value of another type arrives in a field declared as a number",
      alwaysRun: ["class-constructor"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: objectsWithoutSetter,
          changes: ["define-data", "define-accessor", "delete", "reflect-delete", "store-undefined", "store-text", "store-object", "assign", "reflect-set"],
          keys: ["k"],
          presences: ["own"],
          places: references,
          looks: ["add-one", "to-fixed"],
        }),
      ),
    },
    {
      title: "the object that a field holds is replaced by another layout of its type",
      alwaysRun: ["class-fields", "interface-literal"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: objects,
          changes: ["define-same-type", "define-accessor-of-same-type", "delete-and-store", "store-literal-of-the-type", "store-proxy-of-the-type", "change-the-object-it-holds", "freeze"],
          keys: ["inner"],
          places: references,
          looks: ["field-of-the-object-it-holds", "method-of-the-object-it-holds", "store"],
        }),
      ),
    },
    {
      title: "the object that a field holds is replaced by what does not satisfy its type",
      alwaysRun: ["class-constructor"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: objects,
          changes: ["store-instance-of-another-class", "store-null", "store-undefined", "store-number", "delete", "reflect-set"],
          keys: ["inner"],
          places: references,
          looks: ["field-of-the-object-it-holds", "method-of-the-object-it-holds"],
        }),
      ),
    },
    {
      title: "a method is replaced",
      alwaysRun: ["subclass-held-as-parent"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: objects,
          targets: ["itself", "prototype"],
          changes: ["store-function", "define-same-type", "define-getter-of-same-type", "delete", "prototype-to-another-class", "prototype-to-null"],
          keys: ["m"],
          places: ["between-uses", "held-in-field", "parameter-in-a-hot-loop"],
          looks: ["call-method"],
        }),
      ),
    },
    {
      title: "an optional field is absent and the prototype is changed",
      alwaysRun: ["class-fields"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: ["class-fields", "class-constructor", "subclass", "interface-class"],
          aboves: ["nothing-above", "planted-data", "planted-accessor", "planted-read-only"],
          targets: ["prototype"],
          changes: ["define-same-type", "define-data", "define-accessor-of-same-type", "define-read-only-same-type", "freeze"],
          keys: ["k"],
          presences: ["absent"],
          places: ["before-first-instance", "between-uses", "between-instances"],
          looks: ["add-one", "store"],
        }),
      ),
    },
    {
      title: "an array of numbers keeps its type and changes in every other way",
      alwaysRun: ["array"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: arrays,
          changes: ["length-to-zero", "length-read-only", "define-accessor-of-same-type", "define-read-only-same-type", "freeze", "seal", "reverse", "push", "shift", "element-double"],
          keys: ["index-1"],
          places: ["between-uses", "held-in-field", "parameter-in-a-hot-loop"],
          looks: ["length", "elements", "store", "push"],
        }),
      ),
    },
    {
      title: "a hole or a value of another type arrives in an array of numbers",
      alwaysRun: ["tuple"],
      programs: programsBy(
        byHolder,
        axesOf({
          ...once,
          holders: arrays,
          changes: ["element-of-another-kind", "push-of-another-kind", "make-hole", "length-grows", "store-past-the-end", "store-undefined", "define-accessor"],
          keys: ["index-1"],
          places: ["between-uses", "held-in-field", "parameter-in-a-hot-loop"],
          looks: ["add-one", "sum-by-index", "sum-of-elements"],
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
  const axes = axesOf(Object.fromEntries(Object.keys(allAxes).flatMap(axis => (option(axis) ? [[axis, option(axis)!.split(",")]] : []))));
  const sample = Number(option("sample") ?? 0);
  const names = option("names");
  if (!sample && !names && !process.argv.includes("--planes") && sizeOf(axes) > 5_000_000) throw new Error(`${sizeOf(axes)} combinations: narrow the axes or pass --sample=<how many>`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "tsconfig.json"), tsconfig);
  const written = new Set<string>();
  const write = (combination: Combination) => {
    const name = nameOf(combination);
    if (written.has(name) || !filter.test(name)) return;
    written.add(name);
    writeFileSync(join(folder, name + ".ts"), textOf(combination));
  };
  if (process.argv.includes("--planes")) {
    testPlanes().forEach((plane, index) => plane.programs.forEach(({ name, text }) => (written.add(`${index}-${name}`), writeFileSync(join(folder, `plane-${index}-${plane.mayBeRefused ? "refusable" : "strict"}-${name}.ts`), text))));
  } else if (names) {
    for (const name of readFileSync(names, "utf8").split("\n")) if (name) write(combinationOf(name));
  } else if (sample) {
    const pick = picker(Number(option("seed") ?? 1));
    for (let attempts = 0; written.size < sample && attempts < sample * 200; attempts++) write(pickCombination(pick, axes));
  } else for (const combination of combinations(axes)) write(combination);
  console.log(`${written.size} programs`);
}
