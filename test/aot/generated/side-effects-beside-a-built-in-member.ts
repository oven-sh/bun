// An expression whose value is a member of a built-in object may do more than read the member: `said(), Object.keys`, `(said(), Object).keys`, `Object[(said(), "keys")]`. What it does besides happens whether or not anybody
// wants the value, and whatever the build knows about the value. Each case writes one such expression in one place and prints what ran, in order, and how the function ended.
// The table: a typed module, an untyped module or a CommonJS file x how the expression is written x what it does besides x where it stands. The member goes round a list, so that each way of writing meets each kind of member.
//
//   bun side-effects-beside-a-built-in-member.ts <folder> [--sample=<how many>] [--only=<regex over names>]
//
// writes <folder>/<how the expression is written>.js, .ts and .cjs.
import { writeCaseFiles, type CaseFile } from "./case-files";

interface Member {
  /** `Array.prototype.slice`, `parseInt` */
  m: string;
  /** `Array.prototype` of `Array.prototype.slice`, `globalThis` of `parseInt`. */
  holder: string;
  name: string;
  /** `Array` */
  global: string;
  /** `.prototype.slice` */
  below: string;
  /** What a call or a construction hands over. */
  operands: string;
}

const member = (text: string): Member => {
  const [, m, operands = ""] = /^([\w.]+)(?:\((.*)\))?$/.exec(text)!;
  const names = m.split(".");
  return { m, holder: names.slice(0, -1).join(".") || "globalThis", name: names.at(-1)!, global: names[0], below: names.slice(1).map(name => `.${name}`).join(""), operands };
};

const members = ["Object.keys", "Math.PI", "Symbol.iterator", "Array.prototype.slice", "JSON.stringify", "Number.MAX_SAFE_INTEGER", "Reflect.ownKeys", "console.log", "Promise.resolve", "String.raw", "globalThis.undefined", "Object", "NaN", "process.platform", "process.nextTick", "Bun.inspect"].map(member);

const called = [
  `Object.keys({ a: 1 })`, `Object.assign({}, { a: 1 })`, `Object.freeze({ a: 1 })`, `Object.create(null)`, `Object.entries({ a: 1 })`, `Object.defineProperty({}, "a", { value: 1 })`, `Object.getPrototypeOf([])`, `Object.is(1, 1)`, `Object.hasOwn({ a: 1 }, "a")`, `Object.fromEntries([["a", 1]])`, `Object.getOwnPropertyNames({ a: 1 })`,
  `Array.isArray([])`, `Array.from([1, 2])`, `Array.of(1, 2)`, `Math.max(1, 2)`, `Math.floor(1.5)`, `Math.abs(-1)`, `Math.imul(2, 3)`, `Math.sqrt(4)`, `Math.pow(2, 3)`, `JSON.parse("[1]")`, `JSON.stringify({ a: 1 })`,
  `String.fromCharCode(65)`, `Number.isInteger(1)`, `Number.parseFloat("1.5")`, `Number.isNaN(1)`, `Symbol.for("a")`, `Reflect.ownKeys({ a: 1 })`, `Reflect.has({ a: 1 }, "a")`, `Reflect.get({ a: 1 }, "a")`, `Reflect.getPrototypeOf([])`, `Promise.resolve(1)`,
  `parseInt("12")`, `isNaN(1)`, `String(1)`, `Number("1")`, `Boolean(0)`, `BigInt(1)`, `Symbol("s")`, `Array(2)`, `Object(1)`, `Error("x")`, `RegExp("a")`, `structuredClone({ a: 1 })`, `encodeURIComponent("a b")`, `Function("return 1")`, `eval("1 + 1")`,
  `Buffer.from("a")`, `Buffer.byteLength("a")`, `Buffer.isBuffer(1)`, `Bun.escapeHTML("<")`, `Bun.stringWidth("a")`,
].map(member);

const constructed = [
  `Map()`, `Set([1])`, `WeakMap()`, `Array(2)`, `Object()`, `Error("x")`, `TypeError("x")`, `Date(0)`, `RegExp("a", "g")`, `Uint8Array(2)`, `ArrayBuffer(2)`, `Promise(settle)`, `Proxy({}, {})`, `Function("return 1")`, `String("a")`, `Number(1)`, `Boolean(true)`,
  `URL("http://a/b")`, `TextEncoder()`, `AbortController()`, `Headers()`,
].map(member);

const lists = { member: members, call: called, construction: constructed };

type Kind = "plain" | "async" | "generator";

/** What the expression does besides. `typed`: how a typed file spells it, where the checker rejects the text. `untypedOnly`: it rejects every spelling. `isInEveryTable`: also beside calls and constructions. */
const besides: { name: string; text: string; typed?: string; kind?: Kind; untypedOnly?: true; isInEveryTable?: true }[] = [
  { name: "a-call", text: `said()`, isInEveryTable: true },
  { name: "a-call-that-throws", text: `thrower()`, isInEveryTable: true },
  { name: "a-call-of-what-is-missing", text: `anything.shout()` },
  { name: "an-assignment", text: `variable = variable + 1`, isInEveryTable: true },
  { name: "a-getter", text: `holder.read`, isInEveryTable: true },
  { name: "an-await", text: `await thenable`, kind: "async", isInEveryTable: true },
  { name: "a-yield", text: `yield "yielded"`, kind: "generator", isInEveryTable: true },
  { name: "a-tag", text: "tag`x`", typed: "void tag`x`" },
  { name: "a-conversion", text: "`${converted}`", typed: "void `${converted}`" },
  { name: "a-name-nobody-declares", text: `neverDeclared`, untypedOnly: true },
];

interface Written {
  /** Statements in front of the one that holds the expression. */
  before?: string;
  expression: string;
}

interface Parts extends Member {
  /** What the expression does besides. */
  e: string;
  /** In a typed file `(x as any)`. */
  any: (text: string) => string;
  /** A number of its own for each case. */
  n: number;
}

type Language = "typed" | "untyped" | "commonjs";
/** `only`: the languages that have the form. Without it, both kinds of module have it. */
type Form = [name: string, write: (parts: Parts) => string | Written, only?: Language[], list?: keyof typeof lists];
const typed: Language[] = ["typed"], untyped: Language[] = ["untyped"], commonjs: Language[] = ["commonjs"], all: Language[] = ["typed", "untyped", "commonjs"];

const forms: Form[] = [
  ["comma", ({ e, m }) => `${e}, ${m}`, all],
  ["comma-in-brackets", ({ e, m }) => `(${e}, ${m})`, all],
  ["comma-in-two-brackets", ({ e, m }) => `((${e}, ${m}))`],
  ["comma-behind-a-comma", ({ e, m }) => `(${e}, ${m}), ${m}`],
  ["comma-of-three", ({ e, m, holder }) => `${e}, ${holder}, ${m}`],
  ["comma-in-the-holder", ({ e, holder, name }) => `(${e}, ${holder}).${name}`, all],
  ["comma-in-the-holder-under-a-key", ({ e, holder, name }) => `(${e}, ${holder})["${name}"]`],
  ["comma-in-the-key", ({ e, holder, name, any }) => `${any(holder)}[(${e}, "${name}")]`, all],
  ["comma-in-a-key-that-is-a-symbol", ({ e }) => `Array.prototype[(${e}, Symbol.iterator)]`],
  ["comma-in-the-global", ({ e, global, below }) => `(${e}, ${global})${below}`],
  ["comma-in-the-global-object", ({ e, global, below, any }) => `${any(`(${e}, globalThis)`)}.${global}${below}`, all],
  ["comma-in-the-key-of-the-global", ({ e, global, below, any }) => `${any("globalThis")}[(${e}, "${global}")]${below}`],
  ["test-of-a-conditional-with-equal-arms", ({ e, m }) => `(${e}, flag) ? ${m} : ${m}`],
  ["arm-of-a-conditional", ({ e, m }) => `flag ? (${e}, ${m}) : ${m}`],
  ["arm-of-a-conditional-that-the-build-decides", ({ e, m }) => `true ? (${e}, ${m}) : ${m}`],
  ["left-of-and", ({ e, m }) => `(${e}, flag) && ${m}`],
  ["left-of-or", ({ e, m }) => `(${e}, !flag) || ${m}`],
  ["left-of-nullish", ({ e, m }) => `(${e}, nothing) ?? ${m}`],
  ["right-of-and", ({ e, m, any }) => `${any(m)} && (${e}, ${m})`],
  ["right-of-or", ({ e, m, any }) => `${any(m)} || (${e}, ${m})`],
  ["right-of-nullish", ({ e, m }) => `${m} ?? (${e}, ${m})`, untyped],
  ["optional-member-of-the-holder", ({ e, holder, name }) => `(${e}, ${holder})?.${name}`],
  ["optional-key", ({ e, holder, name, any }) => `${any(holder)}?.[(${e}, "${name}")]`],
  ["optional-member-of-the-member", ({ e, m, any }) => `${any(`(${e}, ${m})`)}?.name`],
  ["optional-call", ({ e, m, any }) => `${any(`(${e}, ${m})`)}?.({})`],
  ["awaited", ({ e, m }) => `await (${e}, ${m})`],
  ["assigned", ({ e, m }) => ({ before: "let sink;", expression: `sink = (${e}, ${m})` })],
  ["assigned-in-front", ({ e, m }) => ({ before: "let sink;", expression: `(sink = (${e}), ${m})` })],
  ["holder-assigned", ({ e, holder, name }) => ({ before: "let sink;", expression: `(sink = (${e}, ${holder})).${name}` })],
  ["assigned-if-nullish", ({ e, m }) => ({ before: "let sink;", expression: `sink ??= (${e}, ${m})` })],
  ["assigned-through-a-list-pattern", ({ e, m }) => ({ before: "let sink;", expression: `[sink] = [(${e}, ${m})]` })],
  ["assigned-through-an-object-pattern", ({ e, holder, name }) => ({ before: "let sink;", expression: `({ ${name}: sink } = (${e}, ${holder}))` })],
  ["type-of", ({ e, m }) => `typeof (${e}, ${m})`, all],
  ["type-of-a-member-of-a-comma", ({ e, holder, name }) => `typeof (${e}, ${holder}).${name}`],
  ["void", ({ e, m }) => `void (${e}, ${m})`, all],
  ["not", ({ e, m }) => `!(${e}, ${m})`],
  ["not-not", ({ e, m }) => `!!(${e}, ${m})`],
  ["removal-of-a-value", ({ e, m }) => `delete (${e}, ${m})`, untyped],
  ["name-looked-for-in-a-comma", ({ e, holder, name }) => `"${name}" in (${e}, ${holder})`],
  ["comma-looked-for-in-the-holder", ({ e, holder, name }) => `(${e}, "${name}") in ${holder}`],
  ["instance-of", ({ e, m, any }) => `${any(`(${e}, ${m})`)} instanceof Object`],
  ["instance-of-a-comma", ({ e }) => `[] instanceof (${e}, Array)`],
  ["compared", ({ e, m, any }) => `(${e}, ${m}) === ${any(m)}`],
  ["called", ({ e, m, any }) => `${any(`(${e}, ${m})`)}({})`, all],
  ["called-as-a-method-of-a-comma", ({ e, holder, name, any }) => `${any(`(${e}, ${holder})`)}.${name}({})`],
  ["called-under-a-key-that-is-a-comma", ({ e, holder, name, any }) => `${any(holder)}[(${e}, "${name}")]({})`],
  ["called-with-a-comma", ({ e, m }) => `identity((${e}, ${m}))`],
  ["built-in-called-with-a-comma", ({ e, m }) => `Object.is((${e}, ${m}), ${m})`],
  ["constructed", ({ e, m, any }) => `new ${any(`(${e}, ${m})`)}()`],
  ["constructed-from-a-comma", ({ e }) => `new (${e}, Object)()`],
  ["tag", ({ e }) => `(${e}, String.raw)\`a\${1}b\``],
  ["tag-that-is-a-method-of-a-comma", ({ e }) => `(${e}, String).raw\`a\${1}b\``],
  ["part-of-a-template", ({ e, m }) => `\`\${typeof (${e}, ${m})}\``],
  ["spread-in-a-list", ({ e, m }) => `[...(${e}, [${m}])][0]`],
  ["spread-beside-the-member", ({ e, m }) => `[...(${e}, []), ${m}][0]`],
  ["spread-in-a-call", ({ e, m }) => `identity(...(${e}, [${m}] as const))`, typed],
  ["spread-in-a-call", ({ e, m }) => `identity(...(${e}, [${m}]))`, untyped],
  ["spread-in-a-call-of-a-built-in", ({ e }) => `Math.max(...(${e}, [1, 2]))`],
  ["spread-in-an-object", ({ e, m }) => `({ ...(${e}, { a: ${m} }) }).a`],
  ["element-of-a-list", ({ e, m }) => `[(${e}, ${m})][0]`],
  ["field-of-a-literal", ({ e, m }) => `({ a: (${e}, ${m}) }).a`],
  ["computed-key-of-a-literal", ({ e }) => `({ [(${e}, Symbol.iterator)]: 1 })[Symbol.iterator]`],
  ["computed-key-of-a-class", ({ e }) => `typeof class { [(${e}, Symbol.iterator)]() {} }`],
  ["static-field-of-a-class", ({ e, m }) => `(class { static a = (${e}, ${m}); }).a`],
  ["class-above", ({ e }) => `typeof class extends (${e}, Object) {}`],
  ["constant-that-holds-the-holder", ({ e, holder, name }) => ({ before: `const alias = (${e}, ${holder});`, expression: `alias.${name}` }), all],
  ["constant-that-holds-the-member", ({ e, m }) => ({ before: `const alias = (${e}, ${m});`, expression: `alias` })],
  ["variable-that-is-given-the-holder", ({ e, holder, name }) => ({ before: `let alias = ${holder}; alias = (${e}, ${holder});`, expression: `alias.${name}` })],
  ["pattern-on-the-holder", ({ e, holder, name }) => ({ before: `const { ${name}: taken } = (${e}, ${holder});`, expression: `taken` })],
  ["pattern-with-a-computed-key", ({ e, holder, name, any }) => ({ before: `const { [(${e}, "${name}")]: taken } = ${any(holder)};`, expression: `taken` })],
  ["pattern-with-a-default", ({ e, m }) => ({ before: `const { absent = (${e}, ${m}) } = empty;`, expression: `absent` })],
  ["loader-behind-a-comma", ({ e }) => `(${e}, require)("node:path").sep`, all],
  ["module-name-behind-a-comma", ({ e }) => `require((${e}, "node:path")).sep`, all],
  ["module-behind-a-comma", ({ e }) => `(${e}, require("node:path")).sep`, all],
  ["module-asked-of-process-behind-a-comma", ({ e }) => `(${e}, process).getBuiltinModule("node:path").sep`],
  ["module-name-asked-of-process-behind-a-comma", ({ e }) => `process.getBuiltinModule((${e}, "node:path")).sep`],
  ["import-meta-behind-a-comma", ({ e }) => `typeof (${e}, import.meta).url`],
  ["imported-module-name-behind-a-comma", ({ e }) => `(await import((${e}, "node:path"))).sep`],
  ["cast", ({ e, m }) => `(${e}, ${m}) as unknown`, typed],
  ["cast-to-its-own-type", ({ e, m }) => `(${e}, ${m}) as typeof ${m}`, typed],
  ["cast-in-angle-brackets", ({ e, m }) => `<unknown>(${e}, ${m})`, typed],
  ["cast-inside-the-comma", ({ e, m }) => `(${e}, ${m} as unknown)`, typed],
  ["not-null", ({ e, m }) => `(${e}, ${m})!`, typed],
  ["satisfies", ({ e, m }) => `(${e}, ${m}) satisfies unknown`, typed],
  ["constant-cast", ({ e, m }) => `[(${e}, ${m})] as const`, typed],
  ["cast-of-the-holder", ({ e, holder, name }) => `((${e}, ${holder}) as typeof ${holder}).${name}`, typed],
  ["holder-that-is-not-null", ({ e, holder, name }) => `(${e}, ${holder})!.${name}`, typed],
  ["holder-that-satisfies", ({ e, holder, name }) => `((${e}, ${holder}) satisfies object).${name}`, typed],
  ["cast-of-the-key", ({ e, holder, name, any }) => `${any(holder)}[(${e}, "${name}") as "${name}"]`, typed],
  ["cast-of-what-is-done-besides", ({ e, m }) => `((${e}) as unknown, ${m})`, typed],

  ["namespace-behind-a-comma", ({ e }) => `(${e}, namespace).sep`],
  ["namespace-behind-a-comma-under-a-key", ({ e }) => `(${e}, namespace)["sep"]`],
  ["key-of-a-namespace-behind-a-comma", ({ e }) => `namespace[(${e}, "sep")]`],
  ["method-of-a-namespace-behind-a-comma", ({ e }) => `(${e}, namespace).join("a", "b")`],
  ["optional-member-of-a-namespace-behind-a-comma", ({ e }) => `(${e}, namespace)?.sep`],
  ["name-looked-for-in-a-namespace-behind-a-comma", ({ e }) => `"sep" in (${e}, namespace)`],
  ["default-import-behind-a-comma", ({ e }) => `(${e}, imported).sep`],
  ["method-of-a-default-import-behind-a-comma", ({ e }) => `(${e}, imported).join("a", "b")`],
  ["imported-name-behind-a-comma", ({ e }) => `(${e}, sep)`],
  ["imported-function-behind-a-comma", ({ e }) => `(${e}, join)("a", "b")`],

  ["call", ({ e, m, operands, any }) => `${any(`(${e}, ${m})`)}(${operands})`, all, "call"],
  ["call-of-a-method-of-a-comma", ({ e, holder, name, operands, any }) => `${any(`(${e}, ${holder})`)}.${name}(${operands})`, all, "call"],
  ["call-under-a-key-that-is-a-comma", ({ e, holder, name, operands, any }) => `${any(holder)}[(${e}, "${name}")](${operands})`, all, "call"],
  ["call-with-a-comma-in-front-of-the-operands", ({ e, m, operands, any }) => `${any(m)}(...(${e}, []), ${operands})`, undefined, "call"],
  ["call-with-a-comma-behind-the-operands", ({ e, m, operands, any }) => `${any(m)}(${operands}, (${e}, undefined))`, undefined, "call"],
  ["call-with-operands-spread-behind-a-comma", ({ e, m, operands, any }) => `${any(m)}(...(${e}, [${operands}]))`, undefined, "call"],
  ["optional-call-of-a-comma", ({ e, m, operands, any }) => `${any(`(${e}, ${m})`)}?.(${operands})`, undefined, "call"],
  ["call-through-call", ({ e, m, holder, operands, any }) => `${any(`(${e}, ${m})`)}.call(${holder}, ${operands})`, undefined, "call"],
  ["call-through-apply", ({ e, m, holder, operands, any }) => `${any(`(${e}, ${m})`)}.apply(${holder}, [${operands}])`, undefined, "call"],
  ["call-through-reflect", ({ e, m, holder, operands, any }) => `Reflect.apply(${any(`(${e}, ${m})`)}, ${holder}, [${operands}])`, undefined, "call"],
  ["call-through-bind", ({ e, m, holder, operands, any }) => `${any(`(${e}, ${m})`)}.bind(${holder})(${operands})`, undefined, "call"],
  ["call-of-a-constant-that-holds-a-comma", ({ e, m, holder, operands, any }) => ({ before: `const alias = ${any(`(${e}, ${m})`)};`, expression: `alias.call(${holder}, ${operands})` }), undefined, "call"],

  ["construction", ({ e, m, operands, any }) => `new ${any(`(${e}, ${m})`)}(${operands})`, all, "construction"],
  ["construction-of-a-member-of-a-comma", ({ e, m, operands, any }) => `new ${any(`(${e}, globalThis)`)}.${m}(${operands})`, all, "construction"],
  ["construction-under-a-key-that-is-a-comma", ({ e, m, operands, any }) => `new ${any("globalThis")}[(${e}, "${m}")](${operands})`, undefined, "construction"],
  ["construction-with-operands-spread-behind-a-comma", ({ e, m, operands, any }) => `new ${any(m)}(...(${e}, [${operands}]))`, undefined, "construction"],
  ["construction-through-reflect", ({ e, m, operands, any }) => `Reflect.construct(${any(`(${e}, ${m})`)}, [${operands}])`, undefined, "construction"],
  ["construction-of-a-class-below-a-comma", ({ e, m, operands, any }) => `new (class extends ${any(`(${e}, ${m})`)} {})(${operands})`, undefined, "construction"],

  ["exports-of-a-comma", ({ e }) => `(${e}, module).exports`, commonjs],
  ["member-of-the-exports-of-a-comma", ({ e }) => `(${e}, module).exports.present`, commonjs],
  ["member-of-exports-behind-a-comma", ({ e }) => `(${e}, exports).present`, commonjs],
  ["member-of-module-exports-behind-a-comma", ({ e }) => `(${e}, module.exports).present`, commonjs],
  ["exports-under-a-key-that-is-a-comma", ({ e }) => `module[(${e}, "exports")].present`, commonjs],
  ["member-of-exports-under-a-key-that-is-a-comma", ({ e }) => `exports[(${e}, "present")]`, commonjs],
  ["optional-exports-of-a-comma", ({ e }) => `(${e}, module)?.exports.present`, commonjs],
  ["type-of-the-exports-of-a-comma", ({ e }) => `typeof (${e}, module).exports`, commonjs],
  ["type-of-module-behind-a-comma", ({ e }) => `typeof (${e}, module)`, commonjs],
  ["type-of-exports-behind-a-comma", ({ e }) => `typeof (${e}, exports)`, commonjs],
  ["type-of-require-behind-a-comma", ({ e }) => `typeof (${e}, require)`, commonjs],
  ["type-of-the-file-name-behind-a-comma", ({ e }) => `typeof (${e}, __filename)`, commonjs],
  ["field-of-module-behind-a-comma", ({ e }) => `(${e}, module).loaded`, commonjs],
  ["main-module-of-a-comma", ({ e }) => `typeof (${e}, require).main`, commonjs],
  ["require-of-module-behind-a-comma", ({ e }) => `(${e}, module).require("node:path").sep`, commonjs],
  ["store-to-exports-behind-a-comma", ({ e, n }) => `(${e}, exports).stored${n} = ${n}`, commonjs],
  ["store-to-the-exports-of-a-comma", ({ e, n }) => `(${e}, module).exports.stored${n} = ${n}`, commonjs],
  ["store-to-module-exports-behind-a-comma", ({ e, n }) => `(${e}, module.exports).stored${n} = ${n}`, commonjs],
  ["store-to-exports-under-a-key-that-is-a-comma", ({ e, n }) => `exports[(${e}, "stored${n}")] = ${n}`, commonjs],
  ["store-of-a-comma-to-exports", ({ e, n }) => `exports.stored${n} = (${e}, ${n})`, commonjs],
  ["definition-by-a-comma", ({ e, n }) => `typeof (${e}, Object.defineProperty)(exports, "defined${n}", { value: ${n}, enumerable: true })`, commonjs],
  ["definition-by-a-method-of-a-comma", ({ e, n }) => `typeof (${e}, Object).defineProperty(exports, "defined${n}", { value: ${n}, enumerable: true })`, commonjs],
  ["definition-on-exports-behind-a-comma", ({ e, n }) => `typeof Object.defineProperty((${e}, exports), "defined${n}", { value: ${n}, enumerable: true })`, commonjs],
  ["definition-on-the-exports-of-a-comma", ({ e, n }) => `typeof Object.defineProperty((${e}, module).exports, "defined${n}", { value: ${n}, enumerable: true })`, commonjs],
  ["definition-under-a-name-behind-a-comma", ({ e, n }) => `typeof Object.defineProperty(exports, (${e}, "defined${n}"), { value: ${n}, enumerable: true })`, commonjs],
  ["definition-by-a-descriptor-behind-a-comma", ({ e, n }) => `typeof Object.defineProperty(exports, "defined${n}", (${e}, { value: ${n}, enumerable: true }))`, commonjs],
  ["definition-of-a-value-behind-a-comma", ({ e, n }) => `typeof Object.defineProperty(exports, "defined${n}", { value: (${e}, ${n}), enumerable: true })`, commonjs],
];

/** `file`: the statement is one of the file and not of a function. `test`: the value is only tested. */
const places: { name: string; write: (expression: string) => string; file?: true; test?: true }[] = [
  { name: "statement", write: e => `${e};` },
  { name: "statement-of-the-file", write: e => `${e};`, file: true },
  { name: "statement-in-a-loop", write: e => `for (let i = 0; i < 2; i++) { ${e}; }` },
  { name: "operand-of-void", write: e => `void (${e});` },
  { name: "in-front-of-a-comma", write: e => `(${e}), said();` },
  { name: "constant-nobody-reads", write: e => `const unused = (${e});` },
  { name: "head-of-a-loop", write: e => `for (${/\bin\b/.test(e) ? `(${e})` : e}; !flag; ) {}` },
  { name: "step-of-a-loop", write: e => `for (let i = 0; i < 2; i++, ${e}) {}` },
  { name: "default-of-a-parameter-nobody-reads", write: e => `(function (unused = (${e})) {})();` },
  { name: "test-of-an-if", write: e => `if (${e}) trace.push("yes"); else trace.push("no");`, test: true },
  { name: "test-of-a-conditional", write: e => `return (${e}) ? "yes" : "no";`, test: true },
  { name: "returned", write: e => `return (${e});` },
  { name: "argument", write: e => `return identity((${e}));` },
  { name: "constant-that-is-returned", write: e => `const held = (${e}); return held;` },
  { name: "constant-of-the-file", write: e => `const held = (${e}); trace.push(shown(held));`, file: true },
];

const head = (language: Language) => {
  const isTyped = language === "typed";
  const isModule = language !== "commonjs";
  const of = (type: string) => (isTyped ? `: ${type}` : "");
  return `// Expressions whose value is a member of a built-in object and which do something besides.
${isModule ? `import * as namespace from "node:path";\nimport imported, { join, sep } from "node:path";` : `exports.present = 1;`}
let trace${of("string[]")} = [], variable = 0;
const flag = process.argv.length > 0, nothing${of("number | undefined")} = process.argv.length > 0 ? undefined : 1, anything${of("any")} = {}, empty${of("{ absent?: unknown }")} = {};
function said()${of("number")} { trace.push("said"); return 1; }
function thrower()${of("void")} { trace.push("thrower"); throw new RangeError("thrown"); }
const holder = { get read() { trace.push("read"); return 1; } };
const thenable = { then(resolve${of("(value: number) => void")}) { trace.push("then"); resolve(1); } };
function settle(resolve${of("(value: number) => void")}) { resolve(1); }
function tag(texts${of("TemplateStringsArray")}) { trace.push("tagged"); return texts.length; }
const converted = { toString() { trace.push("converted"); return "text"; } };
function identity${isTyped ? "<T>" : ""}(value${of("T")}) { return value; }
function shown(value${of("unknown")})${of("string")} {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "symbol") return value.toString();
  if (Array.isArray(value)) return "list of " + value.length + ": " + value.map(shown).join();
  if (typeof value === "object" && value !== null) return "object " + Object.prototype.toString.call(value) + " " + Object.keys(value).join();
  return typeof value + " " + String(value);
}
function begin() { trace = []; variable = 0; }
function end(name${of("string")}, ending${of("string")}) { console.log(name, "|", trace.join(" "), "|", variable, "|", ending); }
const thrown = (error${of("any")}) => "throws " + error?.constructor?.name;
function finished(value${of("any")}) {
  if (typeof value?.next !== "function" || typeof value[Symbol.iterator] !== "function") return value;
  let step = value.next();
  while (!step.done) { trace.push(String(step.value)); step = value.next(); }
  return step.value;
}
${isModule ? "async " : ""}function t(name${of("string")}, f${of("() => unknown")}) {
  begin();
  let ending;
  try { ending = "gives " + shown(${isModule ? "await " : ""}finished(f())); } catch (error) { ending = thrown(error); }
  end(name, ending);
}
`;
};

/** The checker takes these for expressions without side effects and rejects them on the left of a comma. */
const looksPureToTheChecker = /^(class-above|computed-key-of-a-class|constant-that-holds-the-member|import-meta-behind-a-comma|not|not-not|not-null|part-of-a-template|pattern-.*|tag|tag-that-is-a-method-of-a-comma|test-of-a-conditional-with-equal-arms|type-of|type-of-a-member-of-a-comma)$/;
/** It knows by their syntax what a test of these answers and rejects the test. */
const isDecidedForTheChecker = /^(constant-cast|void)$/;

const extension: Record<Language, string> = { typed: "ts", untyped: "js", commonjs: "cjs" };

export const caseFiles = (): CaseFile[] =>
  (["untyped", "typed", "commonjs"] as const).flatMap(language => {
    const isTyped = language === "typed";
    const any = (text: string) => (isTyped ? `(${text} as any)` : text);
    const functionOf: Record<Kind, string> = { plain: "function ()", async: "async function ()", generator: isTyped ? "function* (): Generator<string, any, undefined>" : "function* ()" };
    return forms
      .filter(([, , only = ["typed", "untyped"]]) => only.includes(language))
      .map(([form, write, , list = "member"], formAt) => {
        const cases: CaseFile["cases"] = [];
        besides.forEach((beside, besideAt) => {
          if (isTyped && beside.untypedOnly) return;
          if (list !== "member" && !beside.isInEveryTable) return;
          places.forEach((place, placeAt) => {
            const chosen = lists[list][(formAt * 5 + besideAt * 3 + placeAt) % lists[list].length];
            const given = write({ ...chosen, e: (isTyped && beside.typed) || beside.text, any, n: cases.length });
            const { before = "", expression } = typeof given === "string" ? { expression: given } : given;
            const isAsync = beside.kind === "async" || /\bawait\b/.test(expression + before);
            if (isAsync && (beside.kind === "generator" || language === "commonjs")) return;
            // A parameter's default holds no `await` and no `yield`.
            if ((isAsync || beside.kind === "generator") && place.name.startsWith("default-of-a-parameter")) return;
            if (beside.kind === "generator" && (place.file || /\bclass\b/.test(expression))) return;
            if (isAsync && /\bclass\b/.test(expression)) return;
            if (isTyped && place.name === "in-front-of-a-comma" && looksPureToTheChecker.test(form)) return;
            if (isTyped && place.test && isDecidedForTheChecker.test(form)) return;
            // Plain Bun does not parse a spread among the operands of `eval`.
            if (/\beval\(\.\.\./.test(expression)) return;
            const declared = isTyped ? before.replace("let sink;", "let sink: any;") : before;
            // The checker rejects a test of a function that is always there.
            const written = isTyped && place.test ? `(${expression}) as unknown` : expression;
            const body = `${declared} ${place.write(written)}`.trim();
            const name = `${language} ${form} ${beside.name} ${place.name}`;
            const line = place.file
              ? `begin(); try { ${body} end("${name}", "completes"); } catch (error) { end("${name}", thrown(error)); }`
              : `${language === "commonjs" ? "" : "await "}t("${name}", ${functionOf[isAsync ? "async" : (beside.kind ?? "plain")]} { ${body} });`;
            cases.push({ name, line });
          });
        });
        const tail = language === "commonjs" ? `console.log(Object.keys(exports).join());\n` : "";
        return { name: `${form}.${extension[language]}`, head: head(language), cases, tail };
      });
  });

if (import.meta.main) writeCaseFiles(caseFiles());
