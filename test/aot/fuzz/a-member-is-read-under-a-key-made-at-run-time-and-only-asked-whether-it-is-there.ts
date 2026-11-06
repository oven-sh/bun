// A table, no seeds: a member of an object is read under a key that is made at run time, and what was read is used in a way that asks only whether it is undefined or null. Many of the members are numbers, texts or booleans.
//
//   whose member it is x what stands for it (itself, a copy by descriptors, a spread, an heir ..) x how the key is made x what is done with what was read
//
// One combination to a program, which asks for every member of the list and for one that is not there. What throws is caught, and the name of its class is printed.
type Named = { name: string; text: string };

const plain =
  'zero: 0, minus: -0, none: NaN, empty: "", no: false, big: 0n, nothing: null, missing: undefined, half: 1.5, text: "t", yes: true, mark: Symbol.iterator';
const plainKeys = ["zero", "minus", "none", "empty", "no", "big", "nothing", "missing", "half", "text", "yes", "mark"];

const holders: readonly (Named & { keys: string[] })[] = [
  { name: "a pattern", text: "/a+/gi", keys: ["lastIndex", "source", "flags", "global"] },
  { name: "what a pattern found", text: '/a/.exec("a")', keys: ["index", "input", "0", "groups", "length"] },
  { name: "a bound function", text: "(function two(a, b) {}).bind(null)", keys: ["length", "name"] },
  { name: "a built-in function", text: "Math.max", keys: ["length", "name"] },
  { name: "a function expression", text: "function one(a) {}", keys: ["length", "name", "prototype"] },
  { name: "an arrow", text: "(a, b, c) => a", keys: ["length", "name"] },
  { name: "a class", text: 'class Counted { static n = 0; static s = ""; }', keys: ["n", "s", "length", "name"] },
  { name: "a list of a length", text: "new Array(3)", keys: ["length", "0"] },
  { name: "the parts of a text", text: '"a,b".split(",")', keys: ["length", "0"] },
  { name: "the keys of an object", text: "Object.keys({ a: 1 })", keys: ["length", "0"] },
  { name: "a list", text: '[0, "", false]', keys: ["length", "0", "1", "2"] },
  { name: "an entry", text: "Object.entries({ zero: 0 })[0]", keys: ["0", "1", "length"] },
  { name: "a text as an object", text: 'new String("ab")', keys: ["length", "0"] },
  { name: "a text", text: '"ab"', keys: ["length", "0"] },
  { name: "a number as an object", text: "new Number(0)", keys: ["toFixed", "constructor"] },
  { name: "a map", text: "new Map([[1, 2]])", keys: ["size", "get"] },
  { name: "a set", text: "new Set()", keys: ["size", "has"] },
  { name: "a typed array", text: "new Uint8Array(2)", keys: ["length", "byteLength", "byteOffset", "0", "buffer"] },
  { name: "a buffer", text: "new ArrayBuffer(0)", keys: ["byteLength", "maxByteLength", "resizable"] },
  { name: "a view", text: "new DataView(new ArrayBuffer(1))", keys: ["byteLength", "byteOffset"] },
  { name: "what an encoder wrote", text: 'new TextEncoder().encode("")', keys: ["length", "byteLength"] },
  { name: "an error", text: 'new Error("")', keys: ["message", "name", "cause"] },
  { name: "a date", text: "new Date(0)", keys: ["getTime", "getDay"] },
  { name: "a symbol as an object", text: 'Object(Symbol(""))', keys: ["description"] },
  { name: "an address", text: 'new URL("http://a/")', keys: ["port", "hash", "search", "host"] },
  {
    name: "an instance",
    text: `new (class { ${plain.replaceAll(": ", " = ").replaceAll(", ", "; ")}; })()`,
    keys: plainKeys,
  },
  { name: "a literal", text: `{ ${plain} }`, keys: plainKeys },
  { name: "a literal that may not change", text: `Object.freeze({ ${plain} })`, keys: plainKeys },
  { name: "a literal without a prototype", text: `{ __proto__: null, ${plain} }`, keys: plainKeys },
  { name: "a parsed text", text: `JSON.parse('{"zero":0,"empty":"","no":false,"nothing":null,"half":1.5}')`, keys: ["zero", "empty", "no", "nothing", "half"] }, // prettier-ignore
  { name: "the arguments of a call", text: '(function () { return arguments; })(0, "")', keys: ["length", "0", "1"] },
  {
    name: "a descriptor",
    text: 'Object.getOwnPropertyDescriptor({ zero: 0 }, "zero")',
    keys: ["value", "writable", "get"],
  },
  { name: "a proxy", text: 'new Proxy({ zero: 0, empty: "" }, {})', keys: ["zero", "empty"] },
  { name: "a promise", text: "Promise.resolve(0)", keys: ["then", "constructor"] },
  { name: "a generator", text: "(function* () {})()", keys: ["next", "return"] },
  { name: "the global object", text: "globalThis", keys: ["NaN", "Infinity", "undefined"] },
  { name: "Math", text: "Math", keys: ["PI", "E", "abs"] },
  { name: "Number", text: "Number", keys: ["EPSILON", "NaN", "MIN_VALUE", "length", "name"] },
  { name: "Symbol", text: "Symbol", keys: ["iterator", "length"] },
];

/** `X` is whose member it is. */
const forms: readonly Named[] = [
  { name: "itself", text: "(X)" },
  { name: "a copy by descriptors below the same prototype", text: "((it) => Object.create(Object.getPrototypeOf(it), Object.getOwnPropertyDescriptors(it)))(X)" }, // prettier-ignore
  { name: "a copy by descriptors", text: "Object.defineProperties({}, Object.getOwnPropertyDescriptors(X))" },
  { name: "a spread", text: "({ ...(X) })" },
  { name: "an assigned copy", text: "Object.assign({}, X)" },
  { name: "an heir", text: "Object.create(Object(X))" },
  { name: "a copy by its own keys", text: "((it) => Object.fromEntries(Reflect.ownKeys(Object(it)).map(key => [key, it[key]])))(X)" }, // prettier-ignore
];

/** How a program asks for every key. `U` is what is done, in which `key` is the key; `KEYS` is the list of keys as it is written. */
const makers: readonly (Named & { each?: (key: string) => string })[] = [
  { name: "the first of a list", text: "", each: key => `[${JSON.stringify(key)}, "other"][0]` },
  { name: "out of a list by a call", text: "", each: key => `["other", ${JSON.stringify(key)}][one()]` },
  { name: "cut out of a text", text: "", each: key => `${JSON.stringify(`${key}x`)}.slice(0, -1)` },
  { name: "joined", text: "", each: key => `[${JSON.stringify(key)}].join("")` },
  { name: "found among the own keys", text: "", each: key => `(Reflect.ownKeys(Object(fresh())).find(own => own === ${JSON.stringify(key)}) ?? ${JSON.stringify(key)})` }, // prettier-ignore
  {
    name: "a parameter",
    text: "function ask(key) { return U; }\nfor (const name of KEYS) attempt(name, () => ask(name));",
  },
  { name: "the variable of a loop", text: "for (const key of KEYS) attempt(key, () => U);" },
  { name: "an element by its index", text: "const keys = KEYS;\nfor (let i = 0; i < keys.length; i++) attempt(keys[i], () => { const key = keys[i]; return U; });" }, // prettier-ignore
  { name: "written", text: "", each: key => JSON.stringify(key) },
];

/** `R` is the read. */
const uses: readonly Named[] = [
  { name: "called if it is there", text: "R?.(0)" },
  { name: "called if it is there, in a list", text: "[R?.(0)]" },
  { name: "called if it is there, and a member of the answer", text: "R?.(0)?.length" },
  { name: "its length if it is there", text: "R?.length" },
  { name: "its text if it is there", text: "R?.toString()" },
  { name: "a member under a key if it is there", text: 'R?.[["length"][0]]' },
  { name: "a method if both are there", text: "R?.valueOf?.()" },
  { name: "it or something else", text: 'R ?? "none"' },
  { name: "its class unless it is null", text: "((it) => it != null && it.constructor.name)(R)" },
  { name: "its class unless it is undefined", text: '((it) => it === undefined ? "none" : it.constructor.name)(R)' },
  { name: "its name in a template", text: "`${R?.name}`" },
  { name: "its kind", text: "typeof R" },
  { name: "called", text: "R(0)" },
  { name: "constructed", text: "new (R)()" },
  { name: "asked instanceof", text: "R instanceof Object" },
  { name: "asked for a key", text: '"length" in R' },
];

const crossed = holders.flatMap(holder =>
  forms.flatMap(form => makers.flatMap(maker => uses.map(use => ({ holder, form, maker, use })))),
);

const laidOut = [[], ["--aot-heat=everything-is-hot"], ["--aot-validate"]];
export const programs = laidOut.length * crossed.length;

/** The flags that the program of that number is built with. */
export const flagsOf = (index: number): string[] => laidOut[Math.floor(index / crossed.length)];

export function programOf(index: number): { file: string; text: string } {
  // Neighbors in the table differ in what is done with what was read alone: a stride that shares no factor with the length of the table takes a run's share from all over it.
  const { holder, form, maker, use } = crossed[((index % crossed.length) * 7919) % crossed.length];
  const keys = [...holder.keys, "other"];
  const done = (key: string) => use.text.replaceAll("R", `fresh()[${key}]`);
  const asks = maker.each
    ? keys.map(key => `attempt(${JSON.stringify(key)}, () => ${done(maker.each!(key))});`).join("\n")
    : maker.text.replaceAll("U", done("key")).replaceAll("KEYS", JSON.stringify(keys));
  return {
    file: "main.mjs",
    text: `console.log(${JSON.stringify(`${holder.name} | ${form.name} | ${maker.name} | ${use.name}`)});
function attempt(label, run) {
  let said;
  try { said = String(run()); } catch (error) { said = "threw " + error.constructor.name; }
  console.log(label, said);
}
function one() { return 1; }
function fresh() { return ${form.text.replaceAll("X", holder.text)}; }
${asks}
`,
  };
}
