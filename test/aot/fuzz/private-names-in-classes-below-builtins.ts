// A class extends a built-in class, so the built-in's constructor makes the object, and the class adds a private name and
// a public field to it. Each scene picks the base (every built-in a class can extend, and bases whose constructor returns
// a proxy, another object or an array), the kind of private name, where the public field is stored and how the object is
// constructed. Objects are made once or in a loop and used right there: their class, prototype, keys and fields.
import type { Random } from "./random";

type Base = { type?: string; args: string; use: string };

/** `type` is the base as TypeScript writes it, `args` goes to super(), `use` is a number read from the object `a`. */
const bases: Record<string, Base> = {
  Array: { type: "Array<number>", args: "", use: "a.push(i) + a.length" },
  Map: { type: "Map<string, number>", args: "", use: 'a.set("k", i).size' },
  Set: { type: "Set<number>", args: "", use: "a.add(i).size" },
  WeakMap: { type: "WeakMap<object, number>", args: "", use: "(a.set(key, i).has(key) ? 1 : 0)" },
  WeakSet: { type: "WeakSet<object>", args: "", use: "(a.add(key).has(key) ? 1 : 0)" },
  Promise: { type: "Promise<number>", args: "() => {}", use: "(typeof a.then).length" },
  Error: { args: '"e"', use: "a.message.length" },
  TypeError: { args: '"e"', use: "a.name.length" },
  RangeError: { args: '"e"', use: "a.message.length" },
  AggregateError: { args: '[], "e"', use: "a.errors.length" },
  RegExp: { args: '"a"', use: '(a.test("a") ? 1 : 0)' },
  Uint8Array: { args: "2", use: "a.length + a[0]" },
  Int32Array: { args: "2", use: "a.length + a[1]" },
  Float64Array: { args: "2", use: "a.byteLength" },
  BigInt64Array: { args: "2", use: "a.length" },
  ArrayBuffer: { args: "8", use: "a.byteLength" },
  DataView: { type: "DataView<ArrayBuffer>", args: "new ArrayBuffer(8)", use: "a.getInt8(0) + a.byteLength" },
  Date: { args: "0", use: "a.getTime()" },
  Object: { args: "", use: "Object.keys(a).length" },
  Number: { args: "5", use: "a.valueOf()" },
  String: { args: '"text"', use: "a.length" },
  Boolean: { args: "true", use: "(a.valueOf() ? 1 : 0)" },
  ReturnsProxy: { args: "", use: "Object.keys(a).length" },
  ReturnsObject: { args: "", use: "Object.keys(a).length" },
  ReturnsArray: { args: "", use: "Object.keys(a).length" },
  Plain: { args: "", use: "Object.keys(a).length" },
};

/** `member` declares the private name in the class NAME. `read` reads it as a number, inside the class. */
const privates: Record<string, { member: string; read: string; brand?: string }> = {
  "a field": { member: "#p = 1;", read: "this.#p", brand: "#p" },
  "a field without a value": { member: "#pOPTIONAL;", read: "(this.#p ?? 1)", brand: "#p" },
  "a method": { member: "#p()TYPE {\n    return 1;\n  }", read: "this.#p()", brand: "#p" },
  "an accessor": { member: "get #p()TYPE {\n    return 1;\n  }", read: "this.#p", brand: "#p" },
  "a static field": { member: "static #s = 1;", read: "NAME.#s" },
  "a static method": { member: "static #s()TYPE {\n    return 1;\n  }", read: "NAME.#s()" },
  "two fields": { member: '#p = 1;\n  #q = "q";', read: "(this.#p + this.#q.length - 1)", brand: "#q" },
  "none": { member: "", read: "1" },
};

/**
 * Where the public field `r` gets its value. `field` declares it, `inConstructor` runs after super(), `method` is one more
 * member, `after` runs where the object `a` was made. VALUE is the number to store.
 */
const stores: Record<string, { field?: string; inConstructor?: string; method?: string; after?: string }> = {
  "in the constructor": { inConstructor: "this.r = VALUE + n;" },
  "as the field's value": { field: "r = 11;" },
  "as the field's value, from the private name": { field: "r = VALUE;" },
  "in a method": { inConstructor: "this.r = 0;", method: "keep(nNUMBER)VOID {\n    this.r = VALUE + n;\n  }", after: "a.keep(i & 1);" }, // prettier-ignore
  "from outside": { inConstructor: "this.r = 0;", after: "a.r = 11 + (i & 1);" },
  "from outside only": { after: "a.r = 11 + (i & 1);" },
  "beside a second field": { inConstructor: 'this.r = VALUE + n;\n    this.q = "q" + n;' },
  "by defineProperty": {
    inConstructor:
      'Object.defineProperty(this, "r", { value: VALUE + n, writable: true, enumerable: true, configurable: true });',
  },
  "before and after a call": { inConstructor: "this.r = 1;\n    this.r += this.m() + n;" },
};

/** Expressions that construct NAME with the argument `i & 1`. */
const constructions = [
  "new NAME(i & 1)",
  "new NAME(i & 1)",
  "new NAME(i & 1)",
  "Reflect.construct(NAME, [i & 1])",
  "Reflect.construct(NAME, [i & 1], OtherNAME)",
  "new BelowNAME(i & 1)",
  "makeNAME(i & 1)",
];

/** Statements that use the object `a` and add to `sum`. */
const uses = [
  "if (a instanceof NAME) sum += a.r;",
  "sum += a.r;",
  "sum += a.m();",
  "sum += a.read();",
  "sum += NAME.has(a) ? 1 : 0;",
  "sum += USE;",
  "if (Object.getPrototypeOf(a) === NAME.prototype) sum++;",
  "sum += Object.keys(a).length;",
  'if ("r" in a) sum += 2;',
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(1, 3); scene < total; scene++) {
    const name = `A${scene}`;
    const baseName = random.pick(Object.keys(bases));
    const base = bases[baseName];
    const secret = random.pick(Object.values(privates));
    const store = random.pick(Object.values(stores));
    const count = random.pick([1, 1, 3, 300, 20000]);
    const filled = (text: string) =>
      text
        .replaceAll("VALUE", `${secret.read} + this.m()`)
        .replaceAll("USE", base.use)
        .replaceAll("NAME", name)
        .replaceAll("NUMBER", as("number"))
        .replaceAll("VOID", as("void"))
        .replaceAll("OPTIONAL", typed ? "?: number" : "")
        .replaceAll("TYPE", as("number"));
    const hasSecondField = store.inConstructor?.includes("this.q") ?? false;
    const members = [
      secret.member,
      // A field's value may read the private name, so it comes after it.
      store.field ?? (typed ? "r!: number;" : ""),
      hasSecondField && typed ? "q!: string;" : "",
      `constructor(n${as("number")}) {\n    super(${base.args});${store.inConstructor ? `\n    ${store.inConstructor}` : ""}\n  }`,
      `m()${as("number")} {\n    return 10;\n  }`,
      `read()${as("number")} {\n    return ${secret.read};\n  }`,
      `static has(x${as("object")})${as("boolean")} {\n    return ${secret.brand ? `${secret.brand} in x` : "x instanceof NAME"};\n  }`,
      store.method ?? "",
    ].filter(Boolean);
    const construction = random.pick(constructions);
    const body = [
      `const a${as(name)} = ${construction};`,
      store.after ?? "",
      ...random.sample(uses, random.between(1, 3)),
      "last = a;",
    ].filter(Boolean);
    scenes.push(
      filled(`class NAME extends ${(typed && base.type) || baseName} {
  ${members.join("\n  ")}
}
${construction.includes("Other") ? `function OtherNAME() {}\nOtherNAME.prototype = Object.create(NAME.prototype);\n` : ""}${construction.includes("Below") ? `class BelowNAME extends NAME {}\n` : ""}${construction.includes("make") ? `function makeNAME(n${as("number")})${as(name)} {\n  return new NAME(n);\n}\n` : ""}try {
  let sum = 0;
  let last${as(`${name} | undefined`)};
  ${count === 1 ? "{\n    const i = 1;" : `for (let i = 0; i < ${count}; i++) {`}
    ${body.join("\n    ")}
  }
  console.log("scene ${scene}", sum, last instanceof NAME, Object.getPrototypeOf(last) === NAME.prototype, Object.keys(last${typed ? "!" : ""}).join(), typeof last${typed ? "!" : ""}.m, NAME.has(last${typed ? "!" : ""}));
} catch (error) {
  console.log("scene ${scene} threw", ${typed ? "(error as Error)" : "error"}.name);
}`),
    );
  }
  return `const key = {};
class ReturnsProxy {
  constructor() {
    return new Proxy(this, {});
  }
}
class ReturnsObject {
  constructor() {
    return Object.create(new.target.prototype);
  }
}
class ReturnsArray {
  constructor() {
    return Reflect.construct(Array, [], new.target);
  }
}
class Plain {}
${scenes.join("\n")}
`;
}
