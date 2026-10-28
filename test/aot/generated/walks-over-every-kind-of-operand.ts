// Whatever walks an operand asks the operand what the language says it asks. An iterable is asked for its iterator, the iterator for `next`, each result for `done` and `value`, and an iterator
// that is left early for `return`. A list-like object is asked for `length`, which is converted to a number, and for its elements. An array iterator does to the object that it goes over what is
// done to a list-like object. A method of Iterator.prototype asks its receiver for `next` and no iterator, and a method of Set.prototype asks a set-like object for `size`, `has` and `keys`.
// Each of these steps may run code of the program, and a program may hold that code for this one step alone. Each case prints what ran, in order, and the answer.
// The table: what walks x what is walked x what else the same walk may be given, in code that never runs.
//
//   bun walks-over-every-kind-of-operand.ts <folder> [--sample=<how many>] [--only=<regex over names>]
//
// writes <folder>/<what walks>.mjs.
import { writeCaseFiles, type CaseFile } from "./case-files";

type Elements = [first: string, second: string];
const elementsOf = {
  numbers: ["1", "2"],
  texts: [`"en"`, `"de"`],
  pairs: [`["a", 1]`, `["b", 2]`],
  objects: [`{ a: 1 }`, `{ b: 2 }`],
  pairsUnderObjects: [`[{ a: 1 }, 1]`, `[{ b: 2 }, 2]`],
  bytes: [`new Uint8Array([1])`, `new Uint8Array([2, 3])`],
} satisfies Record<string, Elements>;

interface Walk {
  name: string;
  /** X stands for the operand. An expression. */
  text: string;
  takes: "an iterable" | "a list-like object" | "either" | "an iterator" | "a set-like object";
  elements?: keyof typeof elementsOf;
  isAsync?: true;
}

const all = (loop: string) => `(() => { const all = []; ${loop} return all; })()`;
const iterable = (name: string, text: string, elements?: Walk["elements"]): Walk => ({
  name,
  text,
  takes: "an iterable",
  elements,
});
const awaited = (name: string, text: string): Walk => ({ name, text, takes: "an iterable", isAsync: true });
const listLike = (name: string, text: string, elements?: Walk["elements"]): Walk => ({
  name,
  text,
  takes: "a list-like object",
  elements,
});
const either = (name: string, text: string, elements?: Walk["elements"]): Walk => ({
  name,
  text,
  takes: "either",
  elements,
});
const method = (name: string, operands = "", then = "") =>
  listLike(`Array.prototype.${name}`, `Array.prototype.${name}.call(X${operands && ", " + operands})${then}`);
const helper = (name: string, operands = "", then = ""): Walk => ({
  name: `Iterator.prototype.${name}.call`,
  text: `Iterator.prototype.${name}.call(X${operands && ", " + operands})${then}`,
  takes: "an iterator",
});
const setMethod = (name: string, text: string): Walk => ({
  name: `Set.prototype.${name}`,
  text,
  takes: "a set-like object",
});

// prettier-ignore
const walks: Walk[] = [
  iterable("spread-in-a-list", `[...X]`),
  iterable("spread-between-elements", `[0, ...X, 3]`),
  iterable("spread-in-a-call", `((...given) => given)(...X)`),
  iterable("spread-in-a-call-of-a-built-in", `Math.max(...X)`),
  iterable("spread-in-a-construction", `new Array(0, ...X)`),
  iterable("for-of", all(`for (const value of X) all.push(value);`)),
  iterable("for-of-left-by-break", all(`for (const value of X) { all.push(value); break; }`)),
  iterable("for-of-left-by-return", `(() => { for (const value of X) return value; })()`),
  iterable("for-of-left-by-throw", `(() => { try { for (const value of X) throw "thrown"; } catch (caught) { return caught; } })()`),
  iterable("pattern-of-two", `(([first, second]) => [first, second])(X)`),
  iterable("pattern-of-one", `(() => { const [first] = X; return first; })()`),
  iterable("pattern-of-none", `(() => { const [] = X; return "taken"; })()`),
  iterable("pattern-of-three", `(() => { const [first, , third] = X; return [first, third]; })()`),
  iterable("pattern-with-a-rest", `(() => { const [first, ...rest] = X; return [first, rest]; })()`),
  iterable("pattern-that-assigns", `(() => { let first, second; [first, second] = X; return [first, second]; })()`),
  iterable("yield-star", `[...(function* () { return yield* X; })()]`),
  either("Array.from", `Array.from(X)`),
  either("Array.from-with-a-function", `Array.from(X, value => [value])`),
  iterable("Set", `new Set(X).size`),
  iterable("Map", `new Map(X).size`, "pairs"),
  iterable("WeakSet", `new WeakSet(X) instanceof WeakSet`, "objects"),
  iterable("WeakMap", `new WeakMap(X) instanceof WeakMap`, "pairsUnderObjects"),
  iterable("Object.fromEntries", `Object.fromEntries(X)`, "pairs"),
  iterable("Object.groupBy", `Object.groupBy(X, value => typeof value)`),
  iterable("Map.groupBy", `Map.groupBy(X, value => typeof value).size`),
  iterable("AggregateError", `new AggregateError(X).errors`),
  iterable("Math.sumPrecise", `Math.sumPrecise(X)`),
  iterable("Iterator.from", `Iterator.from(X).toArray()`),
  iterable("Iterator.from-left-early", `Iterator.from(X).take(1).toArray()`),
  iterable("Iterator.prototype.flatMap", `[0].values().flatMap(() => X).toArray()`),
  iterable("Iterator.concat", `Iterator.concat(X).toArray()`),
  iterable("Intl.ListFormat.prototype.format", `new Intl.ListFormat("en").format(X)`, "texts"),
  either("Uint8Array", `Array.from(new Uint8Array(X))`),
  either("Uint8Array.from", `Array.from(Uint8Array.from(X))`),
  either("Float64Array.from-with-a-function", `Array.from(Float64Array.from(X, value => value / 2))`),
  either("Buffer.from", `Array.from(Buffer.from(X))`),
  iterable("Headers", `new Headers(X).get("a")`, "pairs"),
  iterable("URLSearchParams", `new URLSearchParams(X).toString()`, "pairs"),
  iterable("Blob", `new Blob(X).size`, "texts"),
  awaited("Promise.all", `await Promise.all(X)`),
  awaited("Promise.allSettled", `(await Promise.allSettled(X)).length`),
  awaited("Promise.race", `await Promise.race(X)`),
  awaited("Promise.any", `await Promise.any(X)`),
  awaited("Array.fromAsync", `await Array.fromAsync(X)`),
  awaited("for-await", `await (async () => { const all = []; for await (const value of X) all.push(value); return all; })()`),
  awaited("for-await-left-by-break", `await (async () => { for await (const value of X) return value; })()`),
  awaited("yield-star-in-an-async-generator", `await Array.fromAsync((async function* () { yield* X; })())`),
  listLike("Function.prototype.apply", `((...given) => given).apply(null, X)`),
  listLike("Reflect.apply", `Reflect.apply((...given) => given, null, X)`),
  listLike("Reflect.construct", `Reflect.construct(Array, X)`),
  listLike("String.raw", `String.raw({ raw: X }, "-")`, "texts"),
  listLike("Uint8Array.prototype.set", `(() => { const bytes = new Uint8Array(3); bytes.set(X, 1); return Array.from(bytes); })()`),
  listLike("Intl.getCanonicalLocales", `Intl.getCanonicalLocales(X)`, "texts"),
  listLike("Buffer.concat", `Buffer.concat(X).length`, "bytes"),
  method("at", "1"), method("concat", "[3]", ".length"), method("copyWithin", "0, 1", "[0]"), method("every", "value => value > 0"), method("fill", "7", "[1]"),
  method("filter", "value => value > 1"), method("find", "value => value > 1"), method("findIndex", "value => value > 1"), method("findLast", "value => value > 0"),
  method("findLastIndex", "value => value > 0"), method("flat"), method("flatMap", "value => [value, value]"), method("forEach", "value => say(value)"), method("includes", "2"),
  method("indexOf", "2"), method("join"), method("lastIndexOf", "1"), method("map", "value => value * 2"), method("pop"), method("push", "3"), method("reduce", "(sum, value) => sum + value"),
  method("reduceRight", "(sum, value) => sum + value"), method("reverse", "", "[0]"), method("shift"), method("slice", "1"), method("some", "value => value > 1"), method("sort", "", "[0]"),
  method("splice", "0, 1"), method("toLocaleString"), method("toReversed"), method("toSorted"), method("toSpliced", "0, 1"), method("toString"), method("unshift", "0"), method("with", "0, 7"),
  listLike("Array.prototype.keys", `[...Array.prototype.keys.call(X)]`),
  listLike("Array.prototype.values", `[...Array.prototype.values.call(X)]`),
  listLike("Array.prototype.entries", `[...Array.prototype.entries.call(X)]`),
  listLike("Array.prototype.values-stepped-by-hand", `(() => { const steps = Array.prototype.values.call(X); return [steps.next(), steps.next(), steps.next()]; })()`),
  helper("toArray"), helper("map", "value => value * 2", ".toArray()"), helper("filter", "value => value > 1", ".toArray()"), helper("take", "1", ".toArray()"), helper("drop", "1", ".toArray()"),
  helper("flatMap", "value => [value, value]", ".toArray()"), helper("reduce", "(sum, value) => sum + value"), helper("forEach", "value => say(value)"), helper("some", "value => value > 0"),
  helper("every", "value => value > 1"), helper("find", "value => value > 0"),
  { name: "Iterator.from-an-iterator", text: `Iterator.from(X).toArray()`, takes: "an iterator" },
  { name: "Iterator.prototype.map.call-left-early", text: `(() => { const steps = Iterator.prototype.map.call(X, value => value); steps.next(); return steps.return(); })()`, takes: "an iterator" },
  ...["union", "intersection", "difference", "symmetricDifference"].map(name => setMethod(name, `[...new Set([1, 2, 3]).${name}(X)]`)),
  ...["isSubsetOf", "isSupersetOf", "isDisjointFrom"].map(name => setMethod(name, `new Set([1, 2, 3]).${name}(X)`)),
];

interface Operand {
  name: string;
  text: (elements: Elements) => string;
  is: "an iterable" | "a list-like object" | "both" | "an iterator" | "a set-like object";
  /** It holds what it holds, whatever the walk wants. */
  holdsItsOwn?: true;
  onlyAwaited?: true;
}

const written = ([first, second]: Elements) => `0: ${first}, 1: ${second}`;
const behindGetters = ([first, second]: Elements) =>
  `get 0() { say("0"); return ${first}; }, get 1() { say("1"); return ${second}; }`;

// prettier-ignore
const lengths: [name: string, member: string, elements?: typeof written][] = [
  ["a-written-length", `length: 2`],
  ["a-length-in-a-variable", `length: two`],
  ["a-length-that-is-text", `length: "2"`],
  ["a-getter-for-the-length", `get length() { say("length"); return 2; }`],
  ["a-length-with-valueOf", `length: { valueOf() { say("valueOf"); return 2; } }`],
  ["a-length-with-toString", `length: { toString() { say("toString"); return "2"; } }`],
  ["a-length-with-toPrimitive", `length: { [Symbol.toPrimitive](hint) { say(hint); return 2; } }`],
  ["a-getter-for-a-length-with-valueOf", `get length() { say("length"); return { valueOf() { say("valueOf"); return 2; } }; }`],
  ["an-inherited-length", `__proto__: { length: two }`],
  ["an-inherited-getter-for-the-length", `__proto__: { get length() { say("length"); return 2; } }`],
  ["a-length-whose-valueOf-throws", `length: { valueOf() { say("valueOf"); throw new RangeError("no length"); } }`],
  ["a-getter-for-the-length-that-throws", `get length() { say("length"); throw new RangeError("no length"); }`],
  ["a-written-length-and-getters-for-the-elements", `length: 2`, behindGetters],
  ["a-length-in-a-variable-and-getters-for-the-elements", `length: two`, behindGetters],
];

const kinds = ["values", "keys", "entries"];
const listLikeObjects: Operand[] = lengths.flatMap(([name, member, elements = written]): Operand[] => [
  { name, text: held => `{ ${member}, ${elements(held)} }`, is: "a list-like object" },
  ...kinds.map(
    (kind): Operand => ({
      name: `${name}-and-${kind}-for-its-iterator`,
      text: held => `{ ${member}, ${elements(held)}, [Symbol.iterator]: Array.prototype.${kind} }`,
      is: "an iterable",
    }),
  ),
  ...kinds.map(
    (kind): Operand => ({
      name: `the-${kind}-of-${name}`,
      text: held => `Array.prototype.${kind}.call({ ${member}, ${elements(held)} })`,
      is: "an iterable",
    }),
  ),
]);

const step = (
  [first, second]: Elements,
  result = (done: string, value: string) => `{ done: ${done}, value: ${value} }`,
) =>
  `next() { say("next"); const at = this.at++; return ${result("at > 1", `at > 1 ? undefined : at ? ${second} : ${first}`)}; }, return() { say("return"); return {}; }`;
const told = `{ get(target, key, receiver) { say(typeof key === "symbol" ? key.description : key); return Reflect.get(target, key, receiver); } }`;

// prettier-ignore
const otherOperands: Operand[] = [
  { name: "an-array", text: ([first, second]) => `[${first}, ${second}]`, is: "both" },
  { name: "an-array-with-a-hole", text: ([first]) => `[${first}, , ]`, is: "both" },
  { name: "an-array-with-an-iterator-of-its-own", text: ([first, second]) => `Object.assign([${first}, ${second}], { *[Symbol.iterator]() { say("iterator"); yield this[1]; } })`, is: "both" },
  { name: "an-heir-of-array", text: ([first, second]) => `new (class extends Array { [Symbol.iterator]() { say("iterator"); return super[Symbol.iterator](); } })(${first}, ${second})`, is: "both" },
  { name: "arguments", text: ([first, second]) => `(function () { return arguments; })(${first}, ${second})`, is: "both" },
  { name: "a-text", text: () => `"ab"`, is: "both", holdsItsOwn: true },
  { name: "a-text-in-an-object", text: () => `new String("ab")`, is: "both", holdsItsOwn: true },
  { name: "a-typed-array", text: () => `new Uint8Array([1, 2])`, is: "both", holdsItsOwn: true },
  { name: "a-set", text: ([first, second]) => `new Set([${first}, ${second}])`, is: "an iterable" },
  { name: "a-map", text: ([first, second]) => `new Map([[${first}, ${second}]])`, is: "an iterable" },
  { name: "the-keys-of-a-map", text: ([first, second]) => `new Map([[${first}, 0], [${second}, 0]]).keys()`, is: "an iterable" },
  { name: "the-values-of-an-array", text: ([first, second]) => `[${first}, ${second}].values()`, is: "an iterable" },
  { name: "an-iterator-helper", text: ([first, second]) => `[${first}, ${second}].values().map(value => (say("map"), value))`, is: "an iterable" },
  { name: "a-generator", text: ([first, second]) => `(function* () { say("start"); yield ${first}; yield ${second}; say("end"); })()`, is: "an iterable" },
  { name: "a-generator-with-finally", text: ([first, second]) => `(function* () { try { yield ${first}; yield ${second}; } finally { say("finally"); } })()`, is: "an iterable" },
  { name: "a-generator-method", text: ([first, second]) => `{ *[Symbol.iterator]() { say("start"); yield ${first}; yield ${second}; } }`, is: "an iterable" },
  { name: "a-generator-method-of-a-class", text: ([first, second]) => `new (class { *[Symbol.iterator]() { say("start"); yield ${first}; yield ${second}; } })()`, is: "an iterable" },
  { name: "a-written-iterator", text: held => `{ [Symbol.iterator]() { say("iterator"); return { at: 0, ${step(held)} }; } }`, is: "an iterable" },
  { name: "a-written-iterator-that-is-its-own-iterable", text: held => `{ at: 0, [Symbol.iterator]() { say("iterator"); return this; }, ${step(held)} }`, is: "an iterable" },
  { name: "a-written-iterator-of-a-class", text: held => `new (class { at = 0; [Symbol.iterator]() { say("iterator"); return this; } ${step(held).replace("}, return", "} return")} })()`, is: "an iterable" },
  { name: "a-written-iterator-that-inherits-its-steps", text: held => `{ [Symbol.iterator]() { return { __proto__: { ${step(held)} }, at: 0 }; } }`, is: "an iterable" },
  { name: "a-written-iterator-below-Iterator", text: held => `{ [Symbol.iterator]() { return { __proto__: Iterator.prototype, at: 0, ${step(held)} }; } }`, is: "an iterable" },
  { name: "results-with-getters", text: held => `{ [Symbol.iterator]() { return { at: 0, ${step(held, (done, value) => `{ get done() { say("done"); return ${done}; }, get value() { say("value"); return ${value}; } }`)} }; } }`, is: "an iterable" },
  { name: "a-getter-for-the-iterator", text: ([first, second]) => `{ get [Symbol.iterator]() { say("iterator"); return function* () { yield ${first}; yield ${second}; }; } }`, is: "an iterable" },
  { name: "a-getter-for-next", text: ([first, second]) => `{ [Symbol.iterator]() { let at = 0; return { get next() { say("next"); return () => ({ done: at > 1, value: at++ ? ${second} : ${first} }); } }; } }`, is: "an iterable" },
  { name: "a-getter-for-return", text: ([first, second]) => `{ [Symbol.iterator]() { let at = 0; return { next: () => ({ done: at > 1, value: at++ ? ${second} : ${first} }), get return() { say("return"); return () => ({}); } }; } }`, is: "an iterable" },
  { name: "a-bound-next", text: held => `{ [Symbol.iterator]() { const steps = { at: 0, ${step(held)} }; return { next: steps.next.bind(steps) }; } }`, is: "an iterable" },
  { name: "a-proxy-of-an-array", text: ([first, second]) => `new Proxy([${first}, ${second}], {})`, is: "both" },
  { name: "a-proxy-of-an-array-that-tells", text: ([first, second]) => `new Proxy([${first}, ${second}], ${told})`, is: "both" },
  { name: "a-proxy-of-a-list-like-object-that-tells", text: held => `new Proxy({ length: two, ${written(held)}, [Symbol.iterator]: Array.prototype.values }, ${told})`, is: "both" },
  { name: "a-proxy-of-a-generator-method", text: ([first, second]) => `new Proxy({ *[Symbol.iterator]() { say("start"); yield ${first}; yield ${second}; } }, {})`, is: "an iterable" },
  { name: "an-async-generator", text: ([first, second]) => `(async function* () { say("start"); yield ${first}; yield ${second}; })()`, is: "an iterable", onlyAwaited: true },
  { name: "an-async-generator-method", text: ([first, second]) => `{ async *[Symbol.asyncIterator]() { say("start"); yield ${first}; yield ${second}; } }`, is: "an iterable", onlyAwaited: true },
  { name: "a-written-async-iterator", text: ([first, second]) => `{ [Symbol.asyncIterator]() { let at = 0; return { next() { say("next"); return Promise.resolve({ done: at > 1, value: at++ ? ${second} : ${first} }); }, return() { say("return"); return Promise.resolve({}); } }; } }`, is: "an iterable", onlyAwaited: true },
];

// prettier-ignore
const iterators: Operand[] = [
  { name: "an-iterator-with-next-and-return", text: held => `{ at: 0, ${step(held)} }`, is: "an iterator" },
  { name: "an-iterator-that-inherits-its-steps", text: held => `{ __proto__: { ${step(held)} }, at: 0 }`, is: "an iterator" },
  { name: "an-iterator-of-a-class", text: held => `new (class { at = 0; ${step(held).replace("}, return", "} return")} })()`, is: "an iterator" },
  { name: "an-iterator-with-a-getter-for-next", text: ([first, second]) => `{ get next() { say("next"); let at = 0; return () => ({ done: at > 1, value: at++ ? ${second} : ${first} }); } }`, is: "an iterator" },
  { name: "an-iterator-whose-results-have-getters", text: held => `{ at: 0, ${step(held, (done, value) => `{ get done() { say("done"); return ${done}; }, get value() { say("value"); return ${value}; } }`)} }`, is: "an iterator" },
  { name: "a-generator-as-an-iterator", text: ([first, second]) => `(function* () { say("start"); yield ${first}; yield ${second}; })()`, is: "an iterator" },
];

// prettier-ignore
const sizes: [name: string, member: string][] = [
  ["a-written-size", `size: 2`],
  ["a-size-in-a-variable", `size: two`],
  ["a-getter-for-the-size", `get size() { say("size"); return 2; }`],
  ["a-size-with-valueOf", `size: { valueOf() { say("valueOf"); return 2; } }`],
  ["a-size-with-toString", `size: { toString() { say("toString"); return "2"; } }`],
  ["a-size-with-toPrimitive", `size: { [Symbol.toPrimitive](hint) { say(hint); return 2; } }`],
  ["an-inherited-size", `__proto__: { size: two }`],
];

// prettier-ignore
const keysOfSetLikeObjects: [name: string, member: string][] = [
  ["keys-out-of-an-array", `keys() { say("keys"); return [1, 5].values(); }`],
  ["keys-out-of-a-generator", `*keys() { say("keys"); yield 1; yield 5; }`],
  ["keys-out-of-a-written-iterator", `keys() { say("keys"); return { at: 0, ${step(["1", "5"])} }; }`],
  ["keys-whose-results-have-getters", `keys() { return { at: 0, ${step(["1", "5"], (done, value) => `{ get done() { say("done"); return ${done}; }, get value() { say("value"); return ${value}; } }`)} }; }`],
  ["a-getter-for-keys", `get keys() { say("keys"); return function* () { yield 1; yield 5; }; }`],
];

const setLikeObjects: Operand[] = sizes.flatMap(([size, sizeMember]) =>
  keysOfSetLikeObjects.map(
    ([keys, keysMember]): Operand => ({
      name: `${size}-and-${keys}`,
      text: () => `{ ${sizeMember}, has(value) { say("has"); return value === 1; }, ${keysMember} }`,
      is: "a set-like object",
    }),
  ),
);

const operands = [...listLikeObjects, ...otherOperands, ...iterators, ...setLikeObjects];

/** The walk as the case writes it: `walk` makes the text of the walk over an operand. */
// prettier-ignore
const besides: [name: string, write: (walk: (operand: string) => string, operand: string) => string][] = [
  ["alone", (walk, operand) => `return ${walk(`(${operand})`)};`],
  ["beside-a-walk-over-a-proxy", (walk, operand) => `if (never) return ${walk(`new Proxy([], {})`)}; return ${walk(`(${operand})`)};`],
  ["or-a-proxy", (walk, operand) => `return ${walk(`(never ? new Proxy([], {}) : ${operand})`)};`],
  ["or-an-array", (walk, operand) => `return ${walk(`(never ? [] : ${operand})`)};`],
  ["or-a-value-from-outside", (walk, operand) => `return ${walk(`(never ? (0, eval)("[]") : ${operand})`)};`],
];

const head = (isAsync: boolean) => `const said = [];
const say = word => { said.push(word); };
const never = process.argv.length > 99;
const two = never ? 3 : 2;
const show = value => (value === undefined ? "undefined" : JSON.stringify(value));
${isAsync ? "async " : ""}function t(name, run) {
  said.length = 0;
  let answer;
  try { answer = show(${isAsync ? "await " : ""}run()); } catch (thrown) { answer = "threw " + thrown.name; }
  console.log(name, said.join(), answer);
}
`;

const isIterableOrListLike = (kind: Walk["takes"] | Operand["is"]) =>
  kind !== "an iterator" && kind !== "a set-like object";
const suits = (walk: Walk, operand: Operand) =>
  (walk.takes === operand.is ||
    ((walk.takes === "either" || operand.is === "both") &&
      isIterableOrListLike(walk.takes) &&
      isIterableOrListLike(operand.is))) &&
  (!operand.onlyAwaited || walk.isAsync) &&
  (!operand.holdsItsOwn || !walk.elements);

export const caseFiles = (): CaseFile[] =>
  walks.map(walk => ({
    name: `${walk.name}.mjs`,
    head: head(!!walk.isAsync),
    cases: operands
      .filter(operand => suits(walk, operand))
      .flatMap(operand =>
        besides.map(([beside, write]) => {
          const name = `${walk.name} ${operand.name} ${beside}`;
          const body = write(
            given => walk.text.replaceAll("X", given),
            operand.text(elementsOf[walk.elements ?? "numbers"]),
          );
          return {
            name,
            line: `${walk.isAsync ? "await " : ""}t("${name}", ${walk.isAsync ? "async " : ""}() => { ${body} });`,
          };
        }),
      ),
  }));

if (import.meta.main) writeCaseFiles(caseFiles());
