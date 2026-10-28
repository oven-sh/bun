// The mutation source: takes a program that exists and does to it what a proof about it may have overlooked. A statement is
// inserted that changes an object, array, class or function in scope (another type in a field, a getter, a deleted key, another
// prototype, a frozen object, a hole, a patched built-in, `this` leaking from a constructor, a throw, a re-entrant call ..), or an
// expression is rewritten to mean the same by another route (`f(a)` as `Reflect.apply(f, undefined, [a])`, `o.k` as `o["k"]`).
//
// TypeScript is mutated in two forms: erased to JavaScript first, or as it is, with everything inserted going through `as any`.
// A mutant that does not parse is dropped here; one that does not type-check is dropped by the build.
import { Random } from "./random";
import { isKeyword, model, type Binding, type Gap, type Model } from "./tokens";

// prettier-ignore
export const values = [
  "-0", "NaN", "0", "1", "-1", "0.5", "2147483647", "2147483648", "-2147483648", "-2147483649", "4294967295", "4294967296", "1073741824",
  "9007199254740991", "9007199254740993", "1e21", "1e-7", "Infinity", "-Infinity", "10n", "-1n", '""', '"0"', '"x"', '"-0"', '"1.0"', '"length"', '"\\u{1F600}"',
  '"__proto__"', "null", "undefined", "true", "false", "{}", "[]", "[1.5]", '["a", , 1]', "[[]]", 'Symbol("s")', "Symbol.iterator", "() => 1", "function () { return this; }",
  "{ valueOf() { return 7; } }", '{ toString() { return "k"; } }', "{ [Symbol.toPrimitive]() { return 3; } }", "{ then(resolve) { resolve(5); } }",
  "new Proxy({}, {})", "new Proxy([], {})", "Object.create(null)", "new Date(0)", "/x/g", "new Map()", "new Set([1])", "class {}", "new Error(\"e\")", "new Uint8Array(2)",
  "new Number(1)", 'new String("ab")', "Object(1n)", "globalThis",
];
// prettier-ignore
const keys = ['"0"', '"1"', '"-0"', '"01"', '"1.5"', '"4294967294"', '"4294967295"', '"length"', '"constructor"', '"__proto__"', '"prototype"', '"then"', '"toJSON"', '"valueOf"', '"toString"', '"name"',
  "Symbol.iterator", "Symbol.toPrimitive", "Symbol.toStringTag", "Symbol.hasInstance", "Symbol.species", "Symbol.isConcatSpreadable", "Symbol.asyncIterator", 'Symbol.for("fuzz")', "0", "1", "-1", "1.5", "2 ** 32"];
// Functions of built-in objects that a program may replace.
// prettier-ignore
const patchable = ["Math.max", "Math.min", "Math.floor", "Math.abs", "Math.round", "Math.trunc", "Math.imul", "JSON.stringify", "JSON.parse", "Object.keys", "Object.assign", "Object.entries", "Object.values",
  "Object.freeze", "Object.create", "Object.getPrototypeOf", "Object.defineProperty", "Object.is", "Array.isArray", "Array.from", "Array.of", "Number.isInteger", "Number.parseFloat", "Number.isNaN", "String.fromCharCode",
  "Reflect.get", "Reflect.ownKeys", "Reflect.apply", "globalThis.parseInt", "globalThis.isNaN", "globalThis.String", "globalThis.Number", "globalThis.Array", "globalThis.Object", "globalThis.Map", "globalThis.Symbol",
  "Promise.resolve", "Symbol.for", "Date.now", "BigInt.asIntN"];
// prettier-ignore
const operatorGroups = [["+", "-", "*", "/", "%", "**"], ["<", "<=", ">", ">="], ["===", "!==", "==", "!="], ["&&", "||", "??"], ["&", "|", "^"], ["<<", ">>", ">>>"], ["+=", "-=", "*=", "/=", "%=", "|=", "&=", ">>>=", "**="], ["++", "--"], ["||=", "&&=", "??="]];

interface Context {
  random: Random;
  typed: boolean;
  program: Model;
  gap: Gap;
  /** A number that no other inserted text of this mutant uses. */
  id: number;
}

// Written with loops and natives only: the engine bed has no built-in that is itself written in JavaScript (map, forEach ..).
const helpers: Record<string, string> = {
  fuzzLeaked: "const fuzzLeaked = [];",
  fuzzCount: "const fuzzCount = {};",
  fuzzKeys: `function fuzzKeys(value) {
  try {
    const keys = Reflect.ownKeys(value);
    let text = "";
    for (let i = 0; i < keys.length; i++) text += (i ? "," : "") + String(keys[i]);
    return text;
  } catch (error) {
    return "no keys: " + typeof value;
  }
}`,
  fuzzTry: `function fuzzTry(run) {
  try {
    return run();
  } catch (error) {
    console.log("caught " + (error instanceof Error ? error.constructor.name + (error.message.includes("checks types at run time") ? " of a type check" : error.message.includes("compiled executable") ? " of a locked built-in" : "") : typeof error));
  }
}`,
  fuzzSame: "function fuzzSame(value) {\n  return value;\n}",
  fuzzText: `function fuzzText(value, depth = 0) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "function") return "function";
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 2) return "..";
  try {
    const keys = Reflect.ownKeys(value);
    let text = "";
    for (let i = 0; i < keys.length && i < 20; i++) {
      if (value instanceof Error && keys[i] !== "message" && keys[i] !== "cause") continue;
      const own = Object.getOwnPropertyDescriptor(value, keys[i]);
      text += (i ? "," : "") + String(keys[i]) + (own.enumerable ? "" : "~") + (own.writable === false ? "!" : "") + ":" + ("value" in own ? fuzzText(own.value, depth + 1) : "accessor");
    }
    const prototype = Object.getPrototypeOf(value);
    const name = prototype === null ? "null" : prototype === Object.prototype ? "" : prototype === Array.prototype ? "array" : typeof prototype.constructor === "function" ? prototype.constructor.name : "?";
    // Built-in prototypes and namespaces are locked in a compiled program: whether one is extensible differs by design. The prototypes of the program's own classes go without the letter too.
    if (Object.hasOwn(value, "constructor") || Object.hasOwn(value, Symbol.toStringTag)) return name + "{" + text + "}";
    return name + "{" + text + "}" + (Object.isFrozen(value) ? "F" : Object.isSealed(value) ? "S" : Object.isExtensible(value) ? "" : "P");
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name + (error.message.includes("checks types at run time") ? " of a type check" : error.message.includes("compiled executable") ? " of a locked built-in" : "") : typeof error);
  }
}`,
};
const typedHelpers: Record<string, string> = {
  fuzzLeaked: "const fuzzLeaked: any[] = [];",
  fuzzCount: "const fuzzCount: any = {};",
  fuzzKeys: helpers.fuzzKeys.replace("(value)", "(value: any): string"),
  fuzzTry: helpers.fuzzTry.replace("(run)", "(run: () => any): any"),
  fuzzSame: helpers.fuzzSame.replace("(value)", "<T>(value: T): T"),
  fuzzText: helpers.fuzzText.replace("(value, depth = 0)", "(value: any, depth = 0): string").replace("const own =", "const own: any ="),
};

const ofKind = (gap: Gap, ...kinds: Binding["kind"][]) => gap.bindings.filter(binding => kinds.includes(binding.kind));

function pickBinding({ random, gap }: Context, ...kinds: Binding["kind"][]): Binding | undefined {
  const exact = ofKind(gap, ...kinds);
  // A parameter or a variable with an unknown initializer may hold anything: it stands in now and then.
  const loose = ofKind(gap, "parameter", "unknown");
  if (exact.length && (!loose.length || random.chance(0.75))) return random.pick(exact);
  return loose.length ? random.pick(loose) : undefined;
}

const anyOf = (context: Context, name: string) => (context.typed ? `(${name} as any)` : name);
const value = (context: Context) => (context.typed ? `(${context.random.pick(values)} as any)` : context.random.pick(values));
const property = ({ random, program }: Context) => (program.properties.length && random.chance(0.85) ? random.pick(program.properties) : random.pick(["x", "y", "value", "length", "name", "next", "size"]));
// The same key spelled so that only evaluation finds it.
function spelled(context: Context, key: string): string {
  const { random } = context;
  const half = key.length >> 1;
  return random.pick([
    JSON.stringify(key),
    `[${JSON.stringify(key.slice(0, half))}, ${JSON.stringify(key.slice(half))}].join("")`,
    `${JSON.stringify(key + "!")}.slice(0, -1)`,
    `fuzzSame(${JSON.stringify(key)})`,
    `{ toString() { return ${JSON.stringify(key)}; } }` + (context.typed ? " as any" : ""),
    "`${" + JSON.stringify(key) + "}`",
  ]);
}

type Insertion = (context: Context) => string | undefined;

// Each returns the statements to insert, or undefined when nothing in scope fits.
const insertions: Record<string, Insertion> = {
  storeOtherType: c => {
    const o = pickBinding(c, "object", "instance", "array", "function", "class");
    return o && `${anyOf(c, o.name)}.${property(c)} = ${value(c)};`;
  },
  storeByComputedKey: c => {
    const o = pickBinding(c, "object", "instance", "array", "function");
    return o && `${anyOf(c, o.name)}[${c.random.chance(0.5) ? spelled(c, property(c)) : c.random.pick(keys)}] = ${value(c)};`;
  },
  deleteKey: c => {
    const o = pickBinding(c, "object", "instance", "array");
    return o && (c.random.chance(0.7) ? `delete ${anyOf(c, o.name)}.${property(c)};` : `delete ${anyOf(c, o.name)}[${spelled(c, property(c))}];`);
  },
  deleteAndAddAgain: c => {
    const o = pickBinding(c, "object", "instance");
    const k = property(c);
    return o && `{\n  const kept = ${anyOf(c, o.name)}.${k};\n  delete ${anyOf(c, o.name)}.${k};\n  ${anyOf(c, o.name)}.${k} = kept;\n}`;
  },
  defineAccessor: c => {
    const o = pickBinding(c, "object", "instance", "array", "function", "class");
    const k = property(c);
    return o && `Object.defineProperty(${o.name}, ${spelled(c, k)}, { get() { console.log("get ${k}"); return ${value(c)}; }, set(stored) { console.log("set ${k}"); }, configurable: true, enumerable: ${c.random.chance(0.5)} });`;
  },
  defineData: c => {
    const o = pickBinding(c, "object", "instance", "array", "function", "class");
    return o && `Object.defineProperty(${o.name}, ${spelled(c, property(c))}, { value: ${value(c)}, writable: ${c.random.chance(0.5)}, enumerable: ${c.random.chance(0.5)}, configurable: ${c.random.chance(0.5)} });`;
  },
  defineOnPrototype: c => {
    const k = property(c);
    const owner = ofKind(c.gap, "class", "function");
    if (!owner.length) return;
    const name = c.random.pick(owner).name;
    return c.random.pick([
      `Object.defineProperty(${name}.prototype, ${spelled(c, k)}, { get() { return ${value(c)}; }, set(stored) { console.log("set ${k}"); }, configurable: true });`,
      `${anyOf(c, name)}.prototype.${k} = ${value(c)};`,
      `${anyOf(c, name)}.prototype.${k} = function () { return ${value(c)}; };`,
      `delete ${anyOf(c, name)}.prototype.${k};`,
      `Object.setPrototypeOf(${name}.prototype, { ${k}: ${value(c)} });`,
      `Object.setPrototypeOf(${name}.prototype, null);`,
      `Object.setPrototypeOf(${name}, function () {});`,
      `Object.freeze(${name}.prototype);`,
      `Object.defineProperty(${name}, Symbol.hasInstance, { value: () => ${c.random.chance(0.5)}, configurable: true });`,
      `${anyOf(c, name)}.prototype = { ${k}: ${value(c)} };`,
      `${anyOf(c, name)}.prototype.constructor = ${value(c)};`,
    ]);
  },
  integrity: c => {
    const o = pickBinding(c, "object", "instance", "array", "function", "class");
    return o && `Object.${c.random.pick(["freeze", "seal", "preventExtensions"])}(${o.name});`;
  },
  otherPrototype: c => {
    const o = pickBinding(c, "object", "instance", "array", "function");
    if (!o) return;
    const k = property(c);
    const target = c.random.pick([`{ ${k}: ${value(c)} }`, "null", "[]", "Array.prototype", "Object.create(null)", `{ get ${k}() { return ${value(c)}; }, set ${k}(stored) { console.log("set ${k}"); } }`, `new Proxy({}, { get: (target, key) => (console.log("trap " + String(key)), undefined) })`, "Function.prototype", "Map.prototype"]);
    return c.random.pick([`Object.setPrototypeOf(${o.name}, ${target});`, `${anyOf(c, o.name)}.__proto__ = ${target};`, `${anyOf(c, o.name)}[${spelled(c, "__proto__")}] = ${target};`, `Reflect.setPrototypeOf(${o.name}, ${target});`]);
  },
  assignInto: c => {
    const o = pickBinding(c, "object", "instance", "array");
    return o && `Object.assign(${o.name}, { ${property(c)}: ${value(c)}, ${property(c)}: ${value(c)} });`;
  },
  observe: c => {
    const o = pickBinding(c, "object", "instance", "array", "function", "class", "number", "string");
    if (!o) return;
    const name = anyOf(c, o.name);
    return c.random.pick([
      `console.log("seen " + fuzzText(${o.name}));`,
      `console.log("keys " + fuzzKeys(${o.name}));`,
      `console.log("json " + fuzzTry(() => JSON.stringify(${o.name})));`,
      `for (const key in ${name}) console.log("key " + key);`,
      `console.log("typeof " + typeof ${o.name} + " " + typeof ${name}?.${property(c)});`,
      `console.log("has " + fuzzTry(() => ${JSON.stringify(property(c))} in ${name}) + " " + fuzzTry(() => Object.hasOwn(${name}, ${JSON.stringify(property(c))})));`,
      `console.log("reads " + fuzzText(fuzzTry(() => ${name}.${property(c)})));`,
      `console.log("text " + fuzzTry(() => String(${o.name})).slice(0, 60));`,
    ]);
  },
  handToTheHost: c => {
    const o = pickBinding(c, "object", "instance", "array", "function", "class");
    if (!o) return;
    const change = `${anyOf(c, o.name)}.${property(c)} = ${value(c)}`;
    return c.random.pick([
      `console.log(${o.name});`,
      `fuzzTry(() => structuredClone(${o.name}));`,
      `queueMicrotask(() => { ${change}; });`,
      `Promise.resolve().then(() => { ${change}; });`,
      `setTimeout(() => { ${change}; console.log("timer " + fuzzText(${o.name})); }, 0);`,
      `fuzzTry(() => Bun.inspect(${o.name}));`,
      `fuzzTry(() => Bun.deepEquals(${o.name}, ${o.name}));`,
      `globalThis.fuzzGlobal${c.id} = ${o.name};`.replace("globalThis", c.typed ? "(globalThis as any)" : "globalThis"),
      `fuzzLeaked.push(${o.name});`,
      `fuzzTry(() => new Map([[${o.name}, ${o.name}]]).forEach((held, key) => { ${c.typed ? "(held as any)" : "held"}.${property(c)} = ${value(c)}; }));`,
      `fuzzTry(() => [${o.name}].sort().map(held => { ${c.typed ? "(held as any)" : "held"}.${property(c)} = ${value(c)}; }));`,
      `fuzzTry(() => JSON.stringify({ toJSON() { ${change}; return 1; } }));`,
      `fuzzTry(() => "a".replace("a", () => { ${change}; return "b"; }));`,
      `fuzzTry(() => \`\${{ toString() { ${change}; return ""; } }}\`);`,
      `fuzzTry(() => Array.from({ length: 1 }, () => { ${change}; }));`,
    ]);
  },
  changeLeaked: c => `for (const leaked of fuzzLeaked) fuzzTry(() => { leaked.${property(c)} = ${value(c)}; });`,
  arrayLength: c => {
    const a = pickBinding(c, "array");
    return a && `${anyOf(c, a.name)}.length = ${c.random.pick(["0", "1", `${a.name}.length + 3`, `${a.name}.length - 1`, "2 ** 32 - 1", "100000"])};`;
  },
  arrayElement: c => {
    const a = pickBinding(c, "array");
    if (!a) return;
    const name = anyOf(c, a.name);
    return c.random.pick([
      `${name}.push(${value(c)});`,
      `${name}.unshift(${value(c)});`,
      `${name}[0] = ${value(c)};`,
      `${name}[${a.name}.length + 2] = ${value(c)};`,
      `delete ${name}[0];`,
      `delete ${name}[${a.name}.length - 1];`,
      `${name}["1"] = ${value(c)};`,
      `${name}[-1] = ${value(c)};`,
      `${name}[1.5] = ${value(c)};`,
      `${name}[100000] = ${value(c)};`,
      `${name}.splice(0, 1);`,
      `${name}.splice(1, 0, ${value(c)}, ${value(c)});`,
      `${name}.pop();`,
      `${name}.shift();`,
      `${name}.reverse();`,
      `${name}.fill(${value(c)});`,
      `${name}.sort();`,
      `${name}.copyWithin(0, 1);`,
      `(list => { list[0] = ${value(c)}; })(${name});`,
      `{\n  const alias = ${name};\n  alias.push(${value(c)});\n}`,
      `Object.defineProperty(${a.name}, "0", { get() { return ${value(c)}; }, configurable: true });`,
      `Object.defineProperty(${a.name}, "length", { writable: false });`,
      `${name}[Symbol.iterator] = function* () { yield ${value(c)}; };`,
      `${name}[Symbol.isConcatSpreadable] = false;`,
      `${name}.constructor = { [Symbol.species]: function (length${c.typed ? ": number" : ""}) { return { length }; } };`,
      `${name}.map = () => ${value(c)};`,
      `${name}.extra = ${value(c)};`,
    ]);
  },
  // Index keys on Array.prototype and every key on Object.prototype are refused in a compiled program; other names are not.
  nameOnArrayPrototype: c => c.random.pick([`${anyOf(c, "Array.prototype")}.fuzzExtra = ${value(c)};`, `Object.defineProperty(Array.prototype, "fuzzExtra", { get() { return ${value(c)}; }, configurable: true });`]),
  patchBuiltin: c => {
    const target = anyOf(c, c.random.pick(patchable)).replace(/^\((.*)\.(\w+) as any\)$/, "($1 as any).$2");
    const replacement = c.random.pick([`() => ${value(c)}`, `function (...rest${c.typed ? ": any[]" : ""}) { console.log("patched"); return saved${c.id}.apply(this, rest); }`.replace("function (", c.typed ? "function (this: any, " : "function (")]);
    // Built-in objects are locked in a compiled program. The refusal is printed in the engine's words: around the mutation there may be a handler that swallows it, and nothing would say why the output differs.
    return `const saved${c.id} = ${target};\ntry {\n  ${target} = ${replacement};\n} catch (error) {\n  console.log(String(error));\n  throw error;\n}` + (c.random.chance(0.3) ? `\n${target} = saved${c.id};` : "");
  },
  storeVariable: c => {
    const targets = c.gap.bindings.filter(binding => !binding.constant && binding.kind !== "class" && binding.kind !== "function");
    return targets.length ? `${c.random.pick(targets).name} = ${value(c)};` : undefined;
  },
  replaceFunction: c => {
    const f = ofKind(c.gap, "function").filter(binding => !binding.constant);
    return f.length ? `${anyOf(c, c.random.pick(f).name).replace(/^\((.*) as any\)$/, "$1")} = ${c.typed ? "(" : ""}function () { return ${value(c)}; }${c.typed ? " as any)" : ""};` : undefined;
  },
  throwOnce: c => `if ((fuzzCount.t${c.id} = (fuzzCount.t${c.id} | 0) + 1) === ${c.random.pick([1, 1, 2, 3, 10])}) throw ${c.random.pick(['new RangeError("fuzz")', 'new Error("fuzz")', '"thrown text"', "null", "undefined", "{ thrown: 1 }"])};`,
  leaveEarly: c => {
    const guard = `if ((fuzzCount.l${c.id} = (fuzzCount.l${c.id} | 0) + 1) === ${c.random.pick([1, 2, 3])}) `;
    if (c.gap.inLoop && c.random.chance(0.6)) return guard + c.random.pick(["break;", "continue;"]);
    if (c.gap.inFunction && !c.gap.inConstructor) return guard + (c.random.chance(0.5) ? "return;" : `return ${value(c)};`);
    if (c.gap.inConstructor) return guard + `return ${c.random.pick(["{}", "[]", "Object.create(null)", "fuzzLeaked", "function () {}"])}${c.typed ? " as any" : ""};`;
  },
  reenter: c => {
    const f = pickBinding(c, "function", "class");
    if (!f) return;
    const call = f.kind === "class" ? `new ${anyOf(c, f.name)}()` : `${anyOf(c, f.name)}(${c.random.chance(0.5) ? value(c) : ""})`;
    return `if ((fuzzCount.r${c.id} = (fuzzCount.r${c.id} | 0) + 1) <= ${c.random.pick([1, 2])}) fuzzTry(() => ${call});`;
  },
  leakThis: c => {
    if (!c.gap.inConstructor && !c.gap.inMethod) return;
    const k = property(c);
    return c.random.pick([
      "fuzzLeaked.push(this);",
      `console.log("this has " + fuzzKeys(this));`,
      `console.log("this is " + fuzzText(this));`,
      `${anyOf(c, "this")}.${k} = ${value(c)};`,
      `delete ${anyOf(c, "this")}.${k};`,
      `Object.defineProperty(this, ${spelled(c, k)}, { get() { return ${value(c)}; }, set(stored) { console.log("set ${k}"); }, configurable: true });`,
      "Object.freeze(this);",
      "Object.preventExtensions(this);",
      `Object.setPrototypeOf(this, { ${k}: ${value(c)} });`,
      `fuzzLeaked.push(() => this);`,
      `(held => { held.${k} = ${value(c)}; })(${anyOf(c, "this")});`,
      `fuzzTry(() => ${anyOf(c, "this")}.${k}());`,
    ]);
  },
  changeArguments: c => (c.gap.inFunction ? c.random.pick([`fuzzTry(() => { arguments[0] = ${value(c)}; });`, "fuzzTry(() => { arguments.length = 0; });", `console.log("arguments " + fuzzTry(() => arguments.length));`, "fuzzTry(() => fuzzLeaked.push(arguments));"]) : undefined),
  wait: c => (c.gap.inAsync ? c.random.pick(["await null;", `await { then(resolve${c.typed ? ": any" : ""}) { resolve(${value(c)}); } };`, "await Promise.resolve();", `await new Promise(resolve => setTimeout(resolve, 0));`, `await fuzzTry(async () => { throw new Error("rejected"); });`]) : undefined),
  yieldMore: c => (c.gap.inGenerator ? `yield ${value(c)};` : undefined),
  subclassInstance: c => {
    const classes = ofKind(c.gap, "class");
    const targets = c.gap.bindings.filter(binding => !binding.constant && (binding.kind === "instance" || binding.kind === "parameter" || binding.kind === "unknown"));
    if (!classes.length || !targets.length) return;
    const k = property(c);
    return `${c.random.pick(targets).name} = fuzzTry(() => new (class extends ${c.random.pick(classes).name} { ${k} = ${value(c)}; })());`;
  },
  wrapInProxy: c => {
    const targets = c.gap.bindings.filter(binding => !binding.constant && binding.kind !== "number" && binding.kind !== "string" && binding.kind !== "class");
    if (!targets.length) return;
    const name = c.random.pick(targets).name;
    const handler = c.random.pick(["{}", `{ get(target, key, receiver) { console.log("get " + String(key)); return Reflect.get(target, key, receiver); } }`, `{ has: () => false }`, `{ ownKeys: () => [] }`, `{ set() { return true; } }`, `{ getPrototypeOf: () => null }`]);
    return `if (typeof ${name} === "object" && ${name} !== null || typeof ${name} === "function") ${name} = new Proxy(${anyOf(c, name)}, ${handler});`;
  },
  runtimeText: c => {
    const o = pickBinding(c, "object", "instance", "array", "function");
    return o && c.random.pick([`fuzzTry(() => new Function("held", "held.${property(c)} = 1.5;")(${o.name}));`, `fuzzTry(() => (0, eval)("1 + 1"));`]);
  },
};

type Rewrite = (context: Omit<Context, "gap">, source: string) => { start: number; end: number; text: string } | undefined;

function sites(program: Model, test: (index: number) => boolean): number[] {
  const found: number[] = [];
  for (let index = 0; index < program.tokens.length; index++) if (test(index)) found.push(index);
  return found;
}

const isPlainName = (program: Model, index: number) => {
  const token = program.tokens[index];
  const before = program.tokens[index - 1]?.text;
  return token?.kind === "name" && !isKeyword(token.text) && !token.text.startsWith("#") && before !== "." && before !== "?." && before !== "function" && before !== "class" && before !== "new" && before !== "*" && before !== "get" && before !== "set" && before !== "async" && before !== "static"; // prettier-ignore
};

const rewrites: Record<string, Rewrite> = {
  number: ({ random, program }) => {
    const found = sites(program, i => program.tokens[i].kind === "number" && !program.tokens[i].text.endsWith("n") && program.tokens[i + 1]?.text !== ":");
    if (!found.length) return;
    const token = program.tokens[random.pick(found)];
    const numbers = values.filter(text => /^-?[\d.e+-]+$|^NaN$|Infinity$/.test(text));
    return { start: token.start, end: token.end, text: `(${random.pick(numbers)})` };
  },
  literalOfOtherType: c => {
    const { random, program } = c;
    const found = sites(program, i => (program.tokens[i].kind === "number" || program.tokens[i].kind === "string") && /^[=(,\[:?]|return|=>$/.test(program.tokens[i - 1]?.text ?? "") && /^[;,)\]]$/.test(program.tokens[i + 1]?.text ?? "") && program.tokens[i - 1]?.text !== "from" && program.tokens[i - 2]?.text !== "case");
    if (!found.length) return;
    const token = program.tokens[random.pick(found)];
    return { start: token.start, end: token.end, text: `(${random.pick(values)}${c.typed ? " as any" : ""})` };
  },
  operator: ({ random, program }) => {
    const found = sites(program, i => program.tokens[i].kind === "punctuator" && operatorGroups.some(group => group.includes(program.tokens[i].text)) && /^(name|number|string)$|^punctuator$/.test(program.tokens[i - 1]?.kind ?? "") && /^[\w$)\]"'`]/.test(program.tokens[i - 1]?.text.slice(-1) ?? ""));
    if (!found.length) return;
    const token = program.tokens[random.pick(found)];
    return { start: token.start, end: token.end, text: random.pick(operatorGroups.find(group => group.includes(token.text))!) };
  },
  call: (c, source) => {
    const { random, program } = c;
    const found = sites(program, i => isPlainName(program, i) && program.tokens[i + 1]?.text === "(" && program.partner[i + 1] > 0 && !/^[{]|=>$/.test(program.tokens[program.partner[i + 1] + 1]?.text ?? "") && program.tokens[i].text !== "super" && program.tokens[i].text !== "import" && program.tokens[i].text !== "require");
    if (!found.length) return;
    const at = random.pick(found);
    const f = c.typed ? `(${program.tokens[at].text} as any)` : program.tokens[at].text;
    const close = program.partner[at + 1];
    const list = source.slice(program.tokens[at + 1].end, program.tokens[close].start);
    const more = list.trim() ? ", " + list : "";
    const extra = c.typed ? `(${random.pick(values)} as any)` : random.pick(values);
    const text = random.pick([
      `${f}.call(undefined${more})`,
      `${f}.call(${extra}${more})`,
      `${f}.apply(undefined, [${list}])`,
      `Reflect.apply(${f}, undefined, [${list}])`,
      `${f}.bind(undefined)(${list})`,
      `${f}.bind(undefined${more})()`,
      `(0, ${f})(${list})`,
      `[${f}][0](${list})`,
      `({ run: ${f} }).run(${list})`,
      `${f}()`,
      `${f}(${list.trim() ? list + ", " : ""}${extra})`,
      `${f}(${extra}${more})`,
      `${f}(...[${list}])`,
      `fuzzSame(${f})(${list})`,
      `fuzzTry(() => ${f}(${list}))`,
      `${f}?.(${list})`,
    ]);
    return { start: program.tokens[at].start, end: program.tokens[close].end, text };
  },
  methodCall: (c, source) => {
    const { random, program } = c;
    const found = sites(program, i => isPlainName(program, i) && program.tokens[i + 1]?.text === "." && program.tokens[i + 2]?.kind === "name" && !program.tokens[i + 2].text.startsWith("#") && program.tokens[i + 3]?.text === "(" && program.partner[i + 3] > 0 && program.tokens[i].text !== "console");
    if (!found.length) return;
    const at = random.pick(found);
    const o = c.typed ? `(${program.tokens[at].text} as any)` : program.tokens[at].text;
    const m = program.tokens[at + 2].text;
    const close = program.partner[at + 3];
    const list = source.slice(program.tokens[at + 3].end, program.tokens[close].start);
    const more = list.trim() ? ", " + list : "";
    const extra = c.typed ? `(${random.pick(values)} as any)` : random.pick(values);
    const text = random.pick([
      `${o}[${JSON.stringify(m)}](${list})`,
      `${o}[${spelled({ ...c, gap: undefined! }, m)}](${list})`,
      `${o}.${m}.call(${o}${more})`,
      `${o}.${m}.call(${extra}${more})`,
      `${o}.${m}.apply(${o}, [${list}])`,
      `Reflect.apply(${o}.${m}, ${o}, [${list}])`,
      `${o}.${m}.bind(${o})(${list})`,
      `(0, ${o}.${m})(${list})`,
      `${o}?.${m}?.(${list})`,
      `${o}.${m}()`,
      `${o}.${m}(${list.trim() ? list + ", " : ""}${extra})`,
      `${o}.${m}(...[${list}])`,
      `fuzzTry(() => ${o}.${m}(${list}))`,
      `Reflect.get(${o}, ${JSON.stringify(m)}).call(${o}${more})`,
      `Object.create(${o}).${m}(${list})`,
      `new Proxy(${o}, {}).${m}(${list})`,
    ]);
    return { start: program.tokens[at].start, end: program.tokens[close].end, text };
  },
  construct: (c, source) => {
    const { random, program } = c;
    const found = sites(program, i => program.tokens[i].text === "new" && program.tokens[i + 1]?.kind === "name" && program.tokens[i + 2]?.text === "(" && program.partner[i + 2] > 0);
    if (!found.length) return;
    const at = random.pick(found);
    const name = c.typed ? `(${program.tokens[at + 1].text} as any)` : program.tokens[at + 1].text;
    const close = program.partner[at + 2];
    const list = source.slice(program.tokens[at + 2].end, program.tokens[close].start);
    const text = random.pick([
      `Reflect.construct(${name}, [${list}])`,
      `Reflect.construct(${name}, [${list}], class {})`,
      `Reflect.construct(${name}, [${list}], function () {})`,
      `Reflect.construct(${name}, [${list}], Object)`,
      `new (class extends ${name} {})(${list})`,
      `new (class extends ${name} { extra = 1; })(${list})`,
      `new (${name}.bind(null))(${list})`,
      `new (new Proxy(${name}, {}))(${list})`,
      `new ${name}()`,
      `new ${name}(...[${list}])`,
      `new (fuzzSame(${name}))(${list})`,
      `Object.create(${name}.prototype)`,
      `fuzzTry(() => ${name}(${list}))`,
    ]);
    return { start: program.tokens[at].start, end: program.tokens[close].end, text: c.typed ? `(${text} as any)` : `(${text})` };
  },
  read: c => {
    const { random, program } = c;
    const found = sites(program, i => isPlainName(program, i) && program.tokens[i + 1]?.text === "." && program.tokens[i + 2]?.kind === "name" && !program.tokens[i + 2].text.startsWith("#") && /^[;,)\]+\-*/<>]|^===|^!==|^&&|^\|\|$/.test(program.tokens[i + 3]?.text ?? "") && !/^(\+\+|--)$/.test(program.tokens[i + 3]?.text ?? "") && !/^(\+\+|--|delete|typeof)$/.test(program.tokens[i - 1]?.text ?? ""));
    if (!found.length) return;
    const at = random.pick(found);
    const o = c.typed ? `(${program.tokens[at].text} as any)` : program.tokens[at].text;
    const k = program.tokens[at + 2].text;
    const text = random.pick([`${o}[${JSON.stringify(k)}]`, `${o}[${spelled({ ...c, gap: undefined! }, k)}]`, `Reflect.get(${o}, ${JSON.stringify(k)})`, `${o}?.${k}`, `(({ ${k}: read }) => read)(${o})`, `Object.getOwnPropertyDescriptor(${o}, ${JSON.stringify(k)})?.value`, `Object.create(${o}).${k}`, `fuzzSame(${o}).${k}`]);
    return { start: program.tokens[at].start, end: program.tokens[at + 2].end, text };
  },
  argument: c => {
    const { random, program } = c;
    const found = sites(program, i => isPlainName(program, i) && /^[(,]$/.test(program.tokens[i - 1]?.text ?? "") && /^[),]$/.test(program.tokens[i + 1]?.text ?? "") && insideCall(program, i));
    if (!found.length) return;
    const token = program.tokens[random.pick(found)];
    const name = c.typed ? `(${token.text} as any)` : token.text;
    const text = random.pick([`fuzzSame(${name})`, `fuzzTry(() => new Proxy(${name}, {}))`, `fuzzTry(() => Object.create(${name}))`, `fuzzTry(() => Object.freeze(${name}))`, `{ ...${name} }`, `fuzzTry(() => structuredClone(${name}))`, `[${name}][0]`, `(fuzzLeaked.push(${name}), ${name})`, random.pick(values)]);
    return { start: token.start, end: token.end, text: c.typed ? `(${text} as any)` : text };
  },
};

function insideCall(program: Model, index: number): boolean {
  for (let i = index - 1, depth = 0; i >= 0 && index - i < 60; i--) {
    const text = program.tokens[i].text;
    if (program.tokens[i].kind !== "punctuator") continue;
    if (text === ")" || text === "]" || text === "}") depth++;
    else if (text === "[" || text === "{") {
      if (depth-- === 0) return false;
    } else if (text === "(") {
      if (depth-- > 0) continue;
      const close = program.partner[i];
      const callee = program.tokens[i - 1];
      return !!callee && (callee.kind === "name" ? !isKeyword(callee.text) || callee.text === "super" : callee.text === ")" || callee.text === "]") && !/^[{]|=>$/.test(program.tokens[close + 1]?.text ?? "") && program.tokens[i - 2]?.text !== "function";
    }
  }
  return false;
}

export const mutationNames = [...Object.keys(insertions), ...Object.keys(rewrites)];

export interface Mutant {
  text: string;
  /** The names of the mutations that were applied. */
  applied: string[];
}

let parser: Bun.Transpiler | undefined;
let typedParser: Bun.Transpiler | undefined;
export function parses(text: string, typed: boolean): boolean {
  try {
    (typed ? (typedParser ??= new Bun.Transpiler({ loader: "ts" })) : (parser ??= new Bun.Transpiler({ loader: "js" }))).transformSync(text);
    return true;
  } catch {
    return false;
  }
}

/** TypeScript without its types, printed by Bun's transpiler: one statement per line. JavaScript is printed the same way. */
export function erased(text: string, loader: "ts" | "js"): string {
  return new Bun.Transpiler({ loader, target: "bun" }).transformSync(text);
}

/** JavaScript as Bun's transpiler prints it. Plain Bun shows that as the text of a function and a compiled program shows the source, so only a program in this form prints the same text in both. */
export function reprinted(text: string): string {
  try {
    return erased(text, "js");
  } catch {
    return text;
  }
}

export interface MutationOptions {
  /** How many mutations to apply. */
  count?: number;
  /** The names of the mutations to choose from. */
  only?: string[];
  /** Says whether the bed can run the inserted text. */
  allows?: (inserted: string) => boolean;
}

function once(source: string, random: Random, typed: boolean, id: number, { only, allows }: MutationOptions): { text: string; name: string } | undefined {
  const program = model(source);
  const wanted = (name: string) => !only || only.includes(name);
  const insert = program.gaps.length > 0 && random.chance(0.65);
  if (insert) {
    const gap = random.pick(program.gaps);
    const name = random.pick(Object.keys(insertions).filter(wanted));
    if (!name) return;
    let text = insertions[name]({ random, typed, program, gap, id });
    if (!text || allows?.(text) === false) return;
    if (random.chance(0.25) && !/^(const|let|if .* (break|continue|return)|yield|await|return)/.test(text) && !/\b(break|continue|return)\b/.test(text)) text = `try {\n  ${text.replaceAll("\n", "\n  ")}\n} catch (error) {\n  console.log("refused " + (error instanceof Error ? error.constructor.name + (error.message.includes("checks types at run time") ? " of a type check" : error.message.includes("compiled executable") ? " of a locked built-in" : "") : typeof error));\n}`;
    return { text: source.slice(0, gap.offset) + "\n" + gap.indent + text.replaceAll("\n", "\n" + gap.indent) + source.slice(gap.offset), name };
  }
  const name = random.pick(Object.keys(rewrites).filter(wanted));
  if (!name) return;
  const change = rewrites[name]({ random, typed, program, id }, source);
  if (!change || allows?.(change.text) === false) return;
  return { text: source.slice(0, change.start) + change.text + source.slice(change.end), name };
}

/** Applies up to `count` mutations. Returns undefined if none could be applied. */
export function mutate(source: string, random: Random, typed: boolean, options: MutationOptions = {}): Mutant | undefined {
  const count = options.count ?? random.weighted([[5, 1], [3, 2], [2, 3], [1, 5]]);
  let text = source;
  const applied: string[] = [];
  for (let attempt = 0; attempt < count * 6 && applied.length < count; attempt++) {
    const next = once(text, random, typed, attempt, options);
    if (!next || !parses(next.text, typed)) continue;
    text = next.text;
    applied.push(next.name);
  }
  if (!applied.length) return;
  // What the top level still holds at the end is printed, so that a change nobody reads afterwards shows too.
  const program = model(text);
  const seen = random.sample(program.top.filter(binding => binding.kind !== "function" && binding.kind !== "class"), 3);
  for (const binding of seen) text += `\nconsole.log("at the end ${binding.name} " + fuzzTry(() => fuzzText(${binding.name})));`;
  const needed = Object.keys(helpers).filter(name => new RegExp(`\\b${name}\\b`).test(text));
  const imports = /^(?:import\b.*\n|\/\/.*\n|\s*\n)*/.exec(text)![0];
  text = imports + needed.map(name => (typed ? typedHelpers : helpers)[name]).join("\n") + "\n" + text.slice(imports.length) + "\n";
  return parses(text, typed) ? { text, applied } : undefined;
}
