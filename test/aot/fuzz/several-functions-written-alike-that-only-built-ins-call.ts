// Small programs with one to fourteen cases. Each case makes an object, lays a function on it under a name or a symbol that a built-in reads by itself, as a getter or as a member that the built-in
// calls, and hands the object to that built-in. Nothing in the program calls the function. All functions of a program are written alike, and how many there are is drawn, so that the number
// of functions of one form goes through every small number. Most programs also lay all of them in one way. Which cases stand in one file, and in which order, is drawn anew each time.
//
//   the form      a function expression, an arrow, a method taken out of a literal or a class, what a shared factory returns; as it stands, bound once, twice or three times, bound with arguments,
//                 behind a proxy, behind `Function.prototype.call.bind` or `Reflect.apply.bind`
//   laid by       `Object.defineProperty`, `Object.defineProperties`, `Reflect.defineProperty`, `__defineGetter__`, a store under the key, `Object.assign`
//   read by       promises, iteration, sets, JSON, texts and their symbols, conversions, `instanceof`, `concat`, species, errors, descriptors, listeners' options, `String.raw`, buffers
//   the function  counts that it ran, then throws or returns
import type { Random } from "./random";

type Place = {
  says: string;
  key: string;
  object: string;
  use: string;
  // What a member under the key has to be for the built-in to call it; without it only a getter is laid.
  isCalled?: boolean;
  returns?: string;
  // What a getter under the key gives where `undefined` would never let the built-in end.
  gives?: string;
};

const places: readonly Place[] = [
  { says: "constructor resolve", key: `"constructor"`, object: "Promise.resolve(1)", use: "typeof Promise.resolve(o)" },
  { says: "constructor then", key: `"constructor"`, object: "Promise.resolve(1)", use: "typeof o.then(() => 1)" },
  { says: "constructor finally", key: `"constructor"`, object: "Promise.resolve(1)", use: "typeof o.finally(() => 1)" },
  { says: "then resolve", key: `"then"`, object: "{}", use: "typeof (await Promise.resolve(o))", isCalled: false },
  { says: "then await", key: `"then"`, object: "{}", use: "typeof (await o)", isCalled: false },
  {
    says: "iterator groupBy",
    key: "Symbol.iterator",
    object: "{}",
    use: "typeof Object.groupBy(o, x => x)",
    isCalled: true,
    returns: "[][Symbol.iterator]()",
  },
  {
    says: "iterator from",
    key: "Symbol.iterator",
    object: "{}",
    use: "Array.from(o).length",
    isCalled: true,
    returns: "[][Symbol.iterator]()",
  },
  {
    says: "iterator spread",
    key: "Symbol.iterator",
    object: "{}",
    use: "[...o].length",
    isCalled: true,
    returns: "[][Symbol.iterator]()",
  },
  {
    says: "iterator set",
    key: "Symbol.iterator",
    object: "{}",
    use: "new Set(o).size",
    isCalled: true,
    returns: "[][Symbol.iterator]()",
  },
  {
    says: "iterator map",
    key: "Symbol.iterator",
    object: "{}",
    use: "new Map(o).size",
    isCalled: true,
    returns: "[][Symbol.iterator]()",
  },
  {
    says: "iterator all",
    key: "Symbol.iterator",
    object: "{}",
    use: "(await Promise.all(o)).length",
    isCalled: true,
    returns: "[][Symbol.iterator]()",
  },
  {
    says: "iterator pattern",
    key: "Symbol.iterator",
    object: "{}",
    use: "(([first]) => typeof first)(o)",
    isCalled: true,
    returns: "[][Symbol.iterator]()",
  },
  {
    says: "iterator fromEntries",
    key: "Symbol.iterator",
    object: "{}",
    use: "Object.keys(Object.fromEntries(o)).length",
    isCalled: true,
    returns: "[][Symbol.iterator]()",
  },
  { says: "size union", key: `"size"`, object: "{}", use: "new Set().union(o).size" },
  {
    says: "has subset",
    key: `"has"`,
    object: "{ size: 1, keys() {} }",
    use: "new Set([1]).isSubsetOf(o)",
    isCalled: true,
    returns: "true",
  },
  {
    says: "toISOString date",
    key: `"toISOString"`,
    object: "new Date(0)",
    use: "JSON.stringify(o)",
    isCalled: true,
    returns: `"iso"`,
  },
  { says: "toJSON", key: `"toJSON"`, object: "{}", use: "JSON.stringify(o)", isCalled: true, returns: "1" },
  {
    says: "toJSON inside",
    key: `"toJSON"`,
    object: "{}",
    use: "JSON.stringify({ inside: [o] })",
    isCalled: true,
    returns: "1",
  },
  {
    says: "replaceAll",
    key: "Symbol.replace",
    object: "{}",
    use: `"a".replaceAll(o, "")`,
    isCalled: true,
    returns: `"r"`,
  },
  { says: "replace", key: "Symbol.replace", object: "{}", use: `"a".replace(o, "")`, isCalled: true, returns: `"r"` },
  { says: "split", key: "Symbol.split", object: "{}", use: `String("a".split(o))`, isCalled: true, returns: `"s"` },
  { says: "match", key: "Symbol.match", object: "{}", use: `String("a".match(o))`, isCalled: true, returns: `"m"` },
  {
    says: "matchAll",
    key: "Symbol.matchAll",
    object: "{}",
    use: `String("a".matchAll(o))`,
    isCalled: true,
    returns: `"m"`,
  },
  { says: "search", key: "Symbol.search", object: "{}", use: `"a".search(o)`, isCalled: true, returns: "3" },
  { says: "match startsWith", key: "Symbol.match", object: "{}", use: `"[object Object]".startsWith(o)` },
  { says: "flags matchAll", key: `"flags"`, object: "/a/g", use: `typeof "a".matchAll(o)` },
  { says: "exec test", key: `"exec"`, object: "/a/", use: `o.test("a")`, isCalled: true, returns: "null" },
  { says: "valueOf", key: `"valueOf"`, object: "{}", use: "+o", isCalled: true, returns: "4" },
  { says: "valueOf compare", key: `"valueOf"`, object: "{}", use: "o < 5", isCalled: true, returns: "4" },
  { says: "toString template", key: `"toString"`, object: "{}", use: "`${o}`", isCalled: true, returns: `"t"` },
  {
    says: "toString key",
    key: `"toString"`,
    object: "{}",
    use: "Object.keys({ [o]: 1 })[0]",
    isCalled: true,
    returns: `"t"`,
  },
  { says: "toString join", key: `"toString"`, object: "{}", use: "[o, o].join()", isCalled: true, returns: `"t"` },
  { says: "toPrimitive", key: "Symbol.toPrimitive", object: "{}", use: `o + ""`, isCalled: true, returns: `"p"` },
  {
    says: "toPrimitive date",
    key: "Symbol.toPrimitive",
    object: "{}",
    use: "typeof new Date(o)",
    isCalled: true,
    returns: "0",
  },
  { says: "length slice", key: `"length"`, object: "{}", use: "Array.prototype.slice.call(o).length" },
  { says: "length apply", key: `"length"`, object: "{}", use: "Math.max.apply(null, o)" },
  { says: "length from", key: `"length"`, object: "{}", use: "Array.from(o).length" },
  { says: "element join", key: `"0"`, object: "{ length: 1 }", use: "Array.prototype.join.call(o)" },
  {
    says: "species map",
    key: "Symbol.species",
    object: "{}",
    use: "(list => ((list.constructor = o), list.map(x => x).length))([1])",
  },
  {
    says: "species then",
    key: "Symbol.species",
    object: "{}",
    use: "(promise => ((promise.constructor = o), typeof promise.then(() => 1)))(Promise.resolve(1))",
  },
  { says: "spreadable", key: "Symbol.isConcatSpreadable", object: "{}", use: "[].concat(o).length" },
  { says: "hasInstance", key: "Symbol.hasInstance", object: "{}", use: "1 instanceof o", isCalled: true, returns: "1" },
  {
    says: "prototype instanceof",
    key: `"prototype"`,
    object: "function () {}.bind()",
    use: "({}) instanceof Object.defineProperty(function () {}, Symbol.hasInstance, { value: undefined }) || typeof o",
  },
  { says: "toStringTag", key: "Symbol.toStringTag", object: "{}", use: "Object.prototype.toString.call(o)" },
  { says: "cause", key: `"cause"`, object: "{}", use: `typeof new Error("m", o).cause` },
  { says: "message", key: `"message"`, object: "{}", use: "Error.prototype.toString.call(o)" },
  { says: "name", key: `"name"`, object: "{}", use: "Error.prototype.toString.call(o)" },
  { says: "descriptor value", key: `"value"`, object: "{}", use: `typeof Object.defineProperty({}, "k", o).k` },
  {
    says: "descriptor enumerable",
    key: `"enumerable"`,
    object: "{}",
    use: `Object.keys(Object.defineProperty({}, "k", o)).length`,
  },
  {
    says: "descriptor create",
    key: `"writable"`,
    object: "{}",
    use: "Object.keys(Object.create(null, { k: o })).length",
  },
  {
    says: "options once",
    key: `"once"`,
    object: "{}",
    use: `typeof new EventTarget().addEventListener("x", () => {}, o)`,
  },
  {
    says: "options signal",
    key: `"signal"`,
    object: "{}",
    use: `typeof new EventTarget().addEventListener("x", () => {}, o)`,
  },
  {
    says: "handleEvent",
    key: `"handleEvent"`,
    object: "{}",
    use: `(target => (target.addEventListener("x", o), target.dispatchEvent(new Event("x"))))(new EventTarget())`,
  },
  { says: "raw", key: `"raw"`, object: "{}", use: "String.raw(o)" },
  { says: "maxByteLength", key: `"maxByteLength"`, object: "{}", use: "new ArrayBuffer(1, o).byteLength" },
  {
    says: "next",
    key: `"next"`,
    object: "{}",
    use: "[...{ [Symbol.iterator]: () => o }].length",
    isCalled: true,
    returns: "{ done: true }",
  },
  {
    says: "done",
    key: `"done"`,
    object: "{}",
    use: "[...{ [Symbol.iterator]: () => ({ next: () => o }) }].length",
    gives: "true",
  },
  {
    says: "return",
    key: `"return"`,
    object: "{ next: () => ({ done: false }) }",
    use: "(([]) => 1)({ [Symbol.iterator]: () => o })",
    isCalled: true,
    returns: "{}",
  },
  { says: "get trap", key: `"get"`, object: "{}", use: "typeof new Proxy({}, o).k", isCalled: true, returns: "1" },
  { says: "has trap", key: `"has"`, object: "{}", use: `"k" in new Proxy({}, o)`, isCalled: true, returns: "true" },
  {
    says: "ownKeys trap",
    key: `"ownKeys"`,
    object: "{}",
    use: "Object.keys(new Proxy({}, o)).length",
    isCalled: true,
    returns: "[]",
  },
  { says: "assign source", key: `"k"`, object: "{}", use: "typeof Object.assign({}, o).k" },
  { says: "spread source", key: `"k"`, object: "{}", use: "typeof { ...o }.k" },
  { says: "entries", key: `"k"`, object: "{}", use: "Object.entries(o).length" },
  { says: "clone", key: `"k"`, object: "{}", use: "typeof structuredClone(o).k" },
  {
    says: "lastIndex",
    key: `"lastIndex"`,
    object: "{ exec: () => null, flags: '' }",
    use: `RegExp.prototype[Symbol.search].call(o, "a")`,
  },
  {
    says: "sort compare",
    key: `"valueOf"`,
    object: "{}",
    use: "[o, o].sort((a, b) => a - b).length",
    isCalled: true,
    returns: "1",
  },
  {
    says: "index of a view",
    key: `"valueOf"`,
    object: "{}",
    use: "new Uint8Array(2).at(o)",
    isCalled: true,
    returns: "1",
  },
  { says: "repeat count", key: `"valueOf"`, object: "{}", use: `"ab".repeat(o)`, isCalled: true, returns: "2" },
];

const forms: readonly ((body: string) => string)[] = [
  body => `function () { ${body} }`,
  body => `function () { ${body} }.bind()`,
  body => `function () { ${body} }.bind().bind()`,
  body => `function () { ${body} }.bind().bind().bind()`,
  body => `function () { ${body} }.bind(null, 1).bind(null, 2)`,
  body => `(() => { ${body} })`,
  body => `(() => { ${body} }).bind()`,
  body => `(() => { ${body} }).bind().bind()`,
  body => `{ member() { ${body} } }.member`,
  body => `{ member() { ${body} } }.member.bind().bind()`,
  body => `class { static member() { ${body} } }.member`,
  body => `wrapped(() => { ${body} })`,
  body => `wrapped(() => { ${body} }).bind().bind()`,
  body => `new Proxy(function () { ${body} }, {})`,
  body => `Function.prototype.call.bind(function () { ${body} })`,
  body => `Reflect.apply.bind(null, function () { ${body} }, undefined, [])`,
];

// Built-ins that read the name inside another built-in, or that construct or call what they were handed.
const deep = [
  "constructor resolve",
  "constructor then",
  "constructor finally",
  "species then",
  "iterator groupBy",
  "size union",
  "toISOString date",
  "replaceAll",
  "replace",
  "search",
  "options once",
  "options signal",
];
const boundForms = forms.filter(form => form("").includes(".bind("));

const layings = [
  [8, "defineProperty"],
  [1, "defineProperties"],
  [1, "Reflect.defineProperty"],
  [1, "__defineGetter__"],
  [2, "store"],
  [1, "assign"],
  [2, "value"],
] as const;

export function generate(random: Random): { file: string; text: string } {
  const count = random.weighted([
    [1, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [3, 6],
    [2, 7],
    [2, 8],
    [2, 9],
    [1, 10],
    [1, 12],
    [1, 14],
  ]);
  // A third of the programs take most of their cases from the short list, with bound functions as getters.
  const isDeep = random.chance(0.35);
  const oneForm = random.pick(isDeep ? boundForms : forms);
  const isMixed = !isDeep && random.chance(0.2);
  const oneLaying = isDeep ? "defineProperty" : random.weighted(layings);
  const isEnumerable = random.chance(0.5);
  const alwaysThrows = random.chance(0.5);
  const isSplit = random.chance(0.6);
  const onePlace = !isDeep && random.chance(0.15) ? random.pick(places) : undefined;
  const left = [...places];
  const takeDeep = () => {
    const among = left.filter(place => deep.includes(place.says));
    return among.length && random.chance(0.85) ? left.splice(left.indexOf(random.pick(among)), 1)[0] : undefined;
  };
  const lines = [
    "let ran = 0;",
    `process.on("unhandledRejection", () => {});`,
    `process.on("uncaughtException", error => console.log("nobody caught " + error.name));`,
    "const wrapped = inner => function () { return inner(); };",
  ];
  const cases: string[] = [];
  for (let at = 0; at < count; at++) {
    const place = onePlace ?? (isDeep ? takeDeep() : undefined) ?? left.splice(random.below(left.length), 1)[0];
    const laying = isMixed ? random.weighted(layings) : oneLaying;
    const asMember = place.isCalled === true && (laying === "store" || laying === "assign" || laying === "value");
    const throws = alwaysThrows || random.chance(0.4);
    const result = asMember
      ? (place.returns ?? "undefined")
      : place.isCalled === true && random.chance(0.5)
        ? `() => ${place.returns}`
        : (place.gives ?? "undefined");
    const body = throws ? `ran++; throw new RangeError("thrown");` : `ran++; return ${result};`;
    const written = (isMixed ? random.pick(forms) : oneForm)(body);
    const key = place.key;
    const more = isEnumerable ? ", enumerable: true" : "";
    const laid = asMember
      ? laying === "store"
        ? `o[${key}] = ${/^[{fc]/.test(written) ? `(${written})` : written};`
        : laying === "assign"
          ? `Object.assign(o, { [${key}]: ${written} });`
          : `Object.defineProperty(o, ${key}, { value: ${written}, configurable: true${more} });`
      : laying === "defineProperties"
        ? `Object.defineProperties(o, { [${key}]: { get: ${written}, configurable: true${more} } });`
        : laying === "Reflect.defineProperty"
          ? `Reflect.defineProperty(o, ${key}, { get: ${written}, configurable: true${more} });`
          : laying === "__defineGetter__"
            ? `o.__defineGetter__(${key}, ${written});`
            : `Object.defineProperty(o, ${key}, { get: ${written}, configurable: true${more} });`;
    const isAsync = place.use.includes("await");
    if (isSplit) {
      lines.push(`${isAsync ? "async " : ""}function use${at}(o) { return ${place.use}; }`);
      lines.push(`function make${at}() { const o = ${place.object}; ${laid} return use${at}(o); }`);
    } else {
      lines.push(
        `${isAsync ? "async " : ""}function make${at}() { const o = ${place.object}; ${laid} return ${place.use}; }`,
      );
    }
    cases.push(`[${JSON.stringify(place.says)}, make${at}]`);
  }
  lines.push(`const cases = [${cases.join(", ")}];`);
  lines.push("for (const [name, run] of cases) {");
  lines.push("  let said;");
  lines.push("  const before = ran;");
  lines.push(`  try { said = String(await run()); } catch (error) { said = "throws " + (error && error.name); }`);
  lines.push(`  console.log(name + ": " + said.slice(0, 60) + " | ran " + (ran - before));`);
  lines.push("}");
  return { file: "main.mjs", text: lines.join("\n") + "\n" };
}
