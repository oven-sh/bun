// A table, no seeds: a file holds a declaration at its top level that nothing uses. Every part of it is quiet to look at, but defining it throws or runs code.
// The entry point loads the file in a try and prints whether it loaded, the kind of the error, and what ran in front of the declaration, inside it and behind it.
//
//   what is declared x how it is declared x how the file is loaded
//
// One case to a program.
type Named = { name: string; text: string };

/** What a class is put below. `declares` stands in front. Most are no constructors; some are. */
const heritages: readonly (Named & { declares?: string })[] = [
  { name: "an object", text: "{}" },
  { name: "a list", text: "[]" },
  { name: "a number", text: "5" },
  { name: "a text", text: '"text"' },
  { name: "undefined", text: "undefined" },
  { name: "null", text: "null" },
  { name: "an arrow", text: "(() => {})" },
  { name: "an async function", text: "(async function () {})" },
  { name: "a generator", text: "(function* () {})" },
  { name: "a method", text: "({ m() {} }).m" },
  { name: "Math", text: "Math" },
  { name: "parseInt", text: "parseInt" },
  { name: "Proxy", text: "Proxy" },
  { name: "Symbol", text: "Symbol" },
  { name: "Function.prototype", text: "Function.prototype" },
  { name: "Object", text: "Object" },
  { name: "a function", text: "(function () {})" },
  { name: "a bound function", text: "(function () {}).bind(null)" },
  { name: "a const that holds an object", declares: "const H = {};", text: "H" },
  { name: "a let that holds an object", declares: "let H = {};", text: "H" },
  { name: "a var that holds an object", declares: "var H = {};", text: "H" },
  { name: "a var that is assigned later", declares: "var H;", text: "H" },
  {
    name: "a var assigned in a branch not taken",
    declares: "var H; if (process.argv.length > 99) H = Object;",
    text: "H",
  },
  { name: "a let that was a class", declares: "let H = class {}; H = 5;", text: "H" },
  { name: "a function whose prototype is a number", declares: "function H() {}\nH.prototype = 5;", text: "H" },
  { name: "a function whose prototype is null", declares: "function H() {}\nH.prototype = null;", text: "H" },
  { name: "a global that was replaced", declares: "globalThis.EvalError = {};", text: "EvalError" },
  { name: "a proxy that tells what is read", declares: 'const H = new Proxy(function () {}, { get(target, key) { seen.push("reads " + String(key)); return target[key]; } });', text: "H" }, // prettier-ignore
  { name: "a variable in its dead zone", text: "Later" },
  { name: "a name that nothing declares", text: "NeverDeclared" },
];

/** `H` is what the class is put below. */
const classForms: readonly Named[] = [
  { name: "a class", text: "class C extends H {}" },
  { name: "a var that holds a class", text: "var C = class extends H {};" },
  { name: "a const that holds a class", text: "const C = class extends H {};" },
  { name: "an exported class", text: "export class C extends H {}" },
  { name: "a class in a block", text: "{ class C extends H {} }" },
  { name: "a class with members", text: "class C extends H { a = 1; m() { return 1; } static s = 2; }" },
];

/** Keys that run code or throw where they become keys. Each declares `k`. */
const keys: readonly Named[] = [
  {
    name: "an object whose toString tells",
    text: 'const k = { toString() { seen.push("toString"); return "key"; } };',
  },
  { name: "an object whose toString throws", text: 'const k = { toString() { throw new RangeError("thrown"); } };' },
  { name: "an object whose Symbol.toPrimitive tells", text: 'const k = { [Symbol.toPrimitive]() { seen.push("toPrimitive"); return "key"; } };' }, // prettier-ignore
  { name: "an object whose Symbol.toPrimitive throws", text: 'const k = { [Symbol.toPrimitive]() { throw new RangeError("thrown"); } };' }, // prettier-ignore
  { name: "an object without a prototype", text: "const k = Object.create(null);" },
  { name: "the text prototype", text: 'const k = "prototype";' },
  { name: "the text prototype, made at run time", text: 'const k = ["proto", "type"].join("");' },
  { name: "the text constructor", text: 'const k = "constructor";' },
];

/** `k` is the key. */
const keyed: readonly Named[] = [
  { name: "a method", text: "class C { [k]() {} }" },
  { name: "a getter", text: "class C { get [k]() { return 1; } }" },
  { name: "a field", text: "class C { [k] = 1; }" },
  { name: "a static method", text: "class C { static [k]() {} }" },
  { name: "a static field", text: "class C { static [k] = 1; }" },
  { name: "a static getter", text: "class C { static get [k]() { return 1; } }" },
  { name: "a member of a literal", text: "const o = { [k]: 1 };" },
  { name: "a method of a literal", text: "var o = { [k]() {} };" },
  { name: "a pattern", text: "const { [k]: taken } = {};" },
];

/** Whole declarations. */
const others: readonly Named[] = [
  { name: "a static method named prototype", text: 'class C { static ["prototype"]() {} }' },
  { name: "a static field named prototype", text: 'class C { static ["prototype"] = 1; }' },
  { name: "a static block", text: 'class C { static { seen.push("block"); } }' },
  { name: "a static field that tells", text: 'class C { static a = seen.push("field"); }' },
  { name: "a static field that throws", text: 'class C { static a = (() => { throw new RangeError("thrown"); })(); }' },
  { name: "a field that would tell", text: 'class C { a = seen.push("never"); }' },
  { name: "a pattern of null", text: "const { a } = null;" },
  { name: "a pattern of undefined", text: "const { a } = undefined;" },
  { name: "an empty pattern of null", text: "const {} = null;" },
  { name: "a list pattern of a number", text: "const [a] = 5;" },
  { name: "a list pattern of an object", text: "const [a] = {};" },
  { name: "an empty list pattern of a number", text: "const [] = 5;" },
  { name: "a pattern with a getter", text: 'const { a } = { get a() { seen.push("getter"); return 1; } };' },
  { name: "a list pattern of an iterator that tells", text: 'const [a] = { [Symbol.iterator]() { seen.push("iterator"); return { next() { return { done: true } } }; } };' }, // prettier-ignore
  { name: "a member of null", text: "const a = null.member;" },
  { name: "a member of a member that is missing", text: "const a = {}.missing.member;" },
  { name: "a variable in its dead zone", text: "const a = Later;" },
  { name: "a name that nothing declares", text: "const a = NeverDeclared;" },
  { name: "typeof a name that nothing declares", text: "const a = typeof NeverDeclared;" },
  { name: "a large whole number and a number", text: "const a = 1n + 1;" },
  { name: "a symbol and a text", text: 'const a = Symbol() + "";' },
  { name: "a symbol in a template", text: "const a = `${Symbol()}`;" },
  { name: "in of a number", text: 'const a = "key" in 5;' },
  { name: "instanceof of a number", text: "const a = {} instanceof 5;" },
  { name: "instanceof of an arrow", text: "const a = {} instanceof (() => {});" },
  { name: "instanceof that tells", text: 'const a = {} instanceof { [Symbol.hasInstance]() { seen.push("hasInstance"); return true; } };' }, // prettier-ignore
  { name: "new of a number", text: "const a = new 5();" },
  { name: "new of an arrow", text: "const a = new (() => {})();" },
  { name: "a call of a number", text: "const a = (5)();" },
  { name: "a spread of a number", text: "const a = [...5];" },
  { name: "a spread of null into a literal", text: "const a = { ...null };" },
  { name: "a list of a wrong length", text: "const a = new Array(-1);" },
  { name: "a text repeated a wrong number of times", text: 'const a = "x".repeat(-1);' },
  { name: "a number in a wrong base", text: "const a = (5).toString(1);" },
  { name: "a regular expression that is wrong", text: 'const a = new RegExp("(");' },
  { name: "text that does not parse", text: 'const a = JSON.parse("{");' },
  { name: "a sum with an object that tells", text: 'const a = 1 + { valueOf() { seen.push("valueOf"); return 1; } };' },
  {
    name: "a comparison with an object that tells",
    text: 'const a = 1 < { valueOf() { seen.push("valueOf"); return 1; } };',
  },
  { name: "a loose comparison with an object that tells", text: 'const a = 1 == { valueOf() { seen.push("valueOf"); return 1; } };' }, // prettier-ignore
  {
    name: "a template with an object that tells",
    text: 'const a = `${{ toString() { seen.push("toString"); return ""; } }}`;',
  },
  { name: "a function whose default would tell", text: 'function never(a = seen.push("never")) {}' },
  {
    name: "a getter of a frozen literal",
    text: 'const a = Object.freeze({ get b() { seen.push("never"); return 1; } });',
  },
  { name: "a tagged template", text: 'const a = (strings => seen.push("tag"))`x`;' },
  { name: "a label and a block", text: 'label: { seen.push("block"); }' },
];

const cases: readonly { label: string; declares: string; text: string }[] = [
  ...heritages.flatMap(above =>
    classForms.map(form => ({
      label: `${form.name} below ${above.name}`,
      declares: above.declares ?? "",
      text: form.text.replace("H", above.text),
    })),
  ),
  ...keys.flatMap(key =>
    keyed.map(form => ({ label: `${form.name} under ${key.name}`, declares: key.text, text: form.text })),
  ),
  ...others.map(other => ({ label: other.name, declares: "", text: other.text })),
];

const loads = ["an awaited import", "an import at the top", "require of a CommonJS file", "an awaited import of TypeScript that nobody checks"] as const; // prettier-ignore

const crossed = cases.flatMap(one => loads.map(load => ({ one, load })));

export const programs = crossed.length;

export function programOf(index: number): { file: string; text: string; files: Record<string, string> } {
  // Neighbors in the table differ in how the file is loaded alone: a stride that shares no factor with the length of the table takes a run's share from all over it.
  const { one, load } = crossed[(index * 7919) % crossed.length];
  const label = JSON.stringify(`${one.label} | ${load}`);
  const body = `const seen = globalThis.seen;\nseen.push("before");\n${one.declares ? one.declares + "\n" : ""}${one.text}\nseen.push("after");\nlet Later = 1;\n`;
  const says = (loading: string) => `globalThis.seen = [];
let said;
try {
  ${loading}
  said = "loaded";
} catch (error) {
  said = error.constructor.name;
}
console.log(${label} + ": " + said + " | " + globalThis.seen.join());
`;
  switch (load) {
    case "an awaited import":
      return { file: "main.js", text: says('await import("./held.js");'), files: { "held.js": body } };
    case "an import at the top":
      return {
        file: "main.js",
        text: says('await import("./between.js");'),
        files: { "between.js": 'import "./held.js";\nglobalThis.seen.push("between");\n', "held.js": body },
      };
    case "require of a CommonJS file":
      return {
        file: "main.cjs",
        text: says('require("./held.cjs");'),
        files: { "held.cjs": body.replace(/^export /gm, "") },
      };
    case "an awaited import of TypeScript that nobody checks":
      return {
        file: "main.js",
        text: says('await import("./held.ts");'),
        files: { "held.ts": "// @ts-nocheck\n" + body },
      };
  }
}
