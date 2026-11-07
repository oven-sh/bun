// The programs of code-that-built-ins-run. `bun test/aot/generate.ts code-that-built-ins-run <where>` writes them.
// A built-in or an operator runs the program's own code: a conversion, a getter, a trap, an iterator, a callback, a species constructor, a thenable. On one of the turns of a loop that code
// changes what the caller of the built-in reads in front of the call and behind it: fields, elements, lengths, prototypes, variables, methods, buffers, collections.
// One way into the program's code and one group of changes a program: what the compiler knows about one call would hide what it does not know about another.
import { programsOf, type WrittenProgram } from "../generate";

const changes: Record<string, string> = {
  "kinds-and-links": `o.a = "changed"; o.z = 9; Object.setPrototypeOf(o, { inherited: 7 }); arr.length = 0; v = "changed"; C.prototype.m = function () { return "new"; }; c.x = "changed"; buf.resize(0); buf2.transfer(); m.clear(); m.set("j", "changed"); st.delete(1); w = ["x"]; fnv = () => "new"; o.f = () => "new";`,
  "gone-and-grown": `delete o.a; arr.push(4.5, "s"); arr[5000] = 1; v = 2.5; c.x = 1.5; buf.resize(16); m.set("k", "changed"); w.length = 1; delete c.x;`,
  "accessors-and-holes": `Object.defineProperty(o, "a", { get() { return "got"; }, configurable: true, enumerable: true }); arr[0] = "s"; delete arr[1]; Object.defineProperty(c, "x", { get() { return "got"; } }); Object.defineProperty(arr, "2", { get() { return "got"; } }); w[0] = { k: 1 }; v = undefined;`,
  "frozen": `Object.freeze(o); Object.freeze(arr); Object.freeze(c); v = null;`,
};

const numberLike = (value: number) => `{ valueOf() { change(); return ${value}; } }`;
const textLike = (text: string) => `{ toString() { change(); return ${JSON.stringify(text)}; } }`;
const primitiveLike = (value: string) => `{ [Symbol.toPrimitive]() { change(); return ${value}; } }`;
const withGetter = (name: string, value: string, others = "") =>
  `{ get ${name}() { change(); return ${value}; }${others ? ", " + others : ""} }`;
const iterable = (values: string) => `{ [Symbol.iterator]() { change(); return ${values}[Symbol.iterator](); } }`;
const iterableWithNext = (values: string) =>
  `{ [Symbol.iterator]() { const inner = ${values}[Symbol.iterator](); return { next() { change(); return inner.next(); } }; } }`;
const iterableWithReturn = (values: string) =>
  `{ [Symbol.iterator]() { const inner = ${values}[Symbol.iterator](); return { next() { return inner.next(); }, return() { change(); return {}; } }; } }`;
const callback = (parameters: string, result: string) => `(${parameters}) => { change(); return ${result}; }`;

/** By name: an expression that runs `change` at least once. */
const triggers: Record<string, string> = {};
const asynchronousTriggers: Record<string, string> = {};
function addTo(table: Record<string, string>, name: string, text: string) {
  if (name in triggers || name in asynchronousTriggers) throw new Error(`two triggers are called ${name}`);
  table[name] = text;
}
const add = (name: string, text: string) => addTo(triggers, name, text);
const addAsynchronous = (name: string, text: string) => addTo(asynchronousTriggers, name, text);

// Array
for (const [m, args] of Object.entries({
  at: [`${numberLike(0)}`],
  copyWithin: [`${numberLike(0)}, 1`, `0, ${numberLike(1)}`, `0, 1, ${numberLike(2)}`],
  fill: [`7, ${numberLike(0)}`, `7, 0, ${numberLike(1)}`],
  includes: [`2, ${numberLike(0)}`],
  indexOf: [`2, ${numberLike(0)}`],
  lastIndexOf: [`2, ${numberLike(2)}`],
  join: [`${textLike("-")}`],
  slice: [`${numberLike(0)}`, `0, ${numberLike(2)}`],
  splice: [`${numberLike(0)}, 0`, `0, ${numberLike(0)}`],
  toSpliced: [`${numberLike(0)}, 0`, `0, ${numberLike(0)}`],
  with: [`${numberLike(0)}, 5`],
  flat: [`${numberLike(1)}`],
}))
  args.forEach((a, i) => add(`array-${m}-${i}`, `arr.${m}(${a})`));
add("array-length-store", `(arr.length = ${numberLike(3)})`);
add("array-constructor-length", `Array(${numberLike(3)}).length`);
add("array-join-elements", `[1, ${textLike("e")}, 3].join()`);
add("array-tostring-elements", `String([1, ${textLike("e")}, 3])`);
add("array-tolocalestring-elements", `[1, { toLocaleString() { change(); return "e"; } }, 3].toLocaleString()`);
add("array-tostring-join", `Array.prototype.toString.call({ join() { change(); return "j"; } })`);
add("array-concat-spreadable", `arr.concat(${withGetter("[Symbol.isConcatSpreadable]", "true", "length: 1, 0: 5")})`);
add(
  "array-concat-length",
  `arr.concat({ [Symbol.isConcatSpreadable]: true, get length() { change(); return 1; }, 0: 5 })`,
);
add(
  "array-concat-element",
  `arr.concat({ [Symbol.isConcatSpreadable]: true, length: 1, get 0() { change(); return 5; } })`,
);
add("array-from-iterable", `Array.from(${iterable("[1, 2]")})`);
add("array-from-next", `Array.from(${iterableWithNext("[1, 2]")})`);
add("array-from-length", `Array.from(${withGetter("length", "2", "0: 1, 1: 2")})`);
add("array-from-element", `Array.from({ length: 1, get 0() { change(); return 1; } })`);
add("array-from-map", `Array.from([1], ${callback("x", "x")})`);
add("array-from-map-of-arr", `Array.from(arr, ${callback("x", "x")})`);
add("array-from-constructor", `Array.from.call(function () { change(); return {}; }, [1])`);
add("array-of-constructor", `Array.of.call(function () { change(); return {}; }, 1)`);
add("array-from-setter", `Array.from.call(function () { return { set length(x) { change(); } }; }, [1])`);
for (const m of [
  "forEach",
  "map",
  "filter",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flatMap",
])
  add(`array-${m}`, `arr.${m}(${callback("x", m === "every" ? "true" : "false")})`);
add("array-reduce", `arr.reduce(${callback("a, x", "a")}, 0)`);
add("array-reduceRight", `arr.reduceRight(${callback("a, x", "a")}, 0)`);
add("array-sort", `arr.sort(${callback("a, b", "0")})`);
add("array-toSorted", `arr.toSorted(${callback("a, b", "0")})`);
add("array-sort-tostring", `[${textLike("b")}, ${textLike("a")}].sort().length`);
for (const [m, a] of Object.entries({
  map: "x => x",
  filter: "x => true",
  slice: "0",
  splice: "0, 0",
  concat: "",
  flat: "",
  flatMap: "x => x",
})) {
  add(
    `array-${m}-species`,
    `(() => { const s = [1, 2]; s.constructor = { [Symbol.species]: function (n) { change(); return []; } }; return s.${m}(${a}); })()`,
  );
  add(
    `array-${m}-constructor-getter`,
    `(() => { const s = [1, 2]; Object.defineProperty(s, "constructor", { get() { change(); return Array; } }); return s.${m}(${a}); })()`,
  );
  add(
    `array-${m}-species-getter`,
    `(() => { const s = [1, 2]; s.constructor = { get [Symbol.species]() { change(); return Array; } }; return s.${m}(${a}); })()`,
  );
}
for (const m of ["push", "pop", "shift", "unshift", "reverse", "includes", "indexOf", "join", "at", "fill", "keys"]) {
  add(
    `arraylike-${m}-length`,
    `Array.prototype.${m}.call({ get length() { change(); return 1; }, set length(x) {}, 0: 1 }, 1)`,
  );
}
for (const m of ["push", "pop", "shift", "unshift"])
  add(
    `arraylike-${m}-length-setter`,
    `Array.prototype.${m}.call({ get length() { return 1; }, set length(x) { change(); }, 0: 1 }, 1)`,
  );
for (const m of [
  "reverse",
  "includes",
  "indexOf",
  "join",
  "at",
  "pop",
  "shift",
  "lastIndexOf",
  "toReversed",
  "toSorted",
  "slice",
])
  add(
    `arraylike-${m}-element`,
    `Array.prototype.${m}.call({ length: 1, get 0() { change(); return 1; }, set 0(x) {} }, 0)`,
  );
add("spread-iterable", `[...${iterable("[1, 2]")}]`);
add("spread-next", `[...${iterableWithNext("[1, 2]")}]`);
add("spread-call", `Math.max(...${iterableWithNext("[1, 2]")})`);
add("destructure-return", `(() => { const [x] = ${iterableWithReturn("[1, 2]")}; return x; })()`);
add("destructure-next", `(() => { const [x, y] = ${iterableWithNext("[1, 2]")}; return x + y; })()`);
add("for-of-return", `(() => { for (const x of ${iterableWithReturn("[1, 2]")}) return x; })()`);

// String
for (const [m, args] of Object.entries({
  at: [numberLike(0)],
  charAt: [numberLike(0)],
  charCodeAt: [numberLike(0)],
  codePointAt: [numberLike(0)],
  indexOf: [textLike("a"), `"a", ${numberLike(0)}`],
  lastIndexOf: [textLike("a"), `"a", ${numberLike(0)}`],
  includes: [textLike("a"), `"a", ${numberLike(0)}`],
  startsWith: [
    textLike("a"),
    `"a", ${numberLike(0)}`,
    withGetter("[Symbol.match]", "false", `toString() { return "a"; }`),
  ],
  endsWith: [textLike("a"), `"a", ${numberLike(1)}`],
  padStart: [numberLike(5), `5, ${textLike("-")}`],
  padEnd: [numberLike(5), `5, ${textLike("-")}`],
  repeat: [numberLike(2)],
  slice: [numberLike(0), `0, ${numberLike(1)}`],
  substring: [numberLike(0), `0, ${numberLike(1)}`],
  substr: [numberLike(0), `0, ${numberLike(1)}`],
  normalize: [textLike("NFC")],
  localeCompare: [textLike("a")],
  concat: [textLike("a")],
  split: [
    textLike("b"),
    `"b", ${numberLike(2)}`,
    withGetter("[Symbol.split]", "undefined", `toString() { return "b"; }`),
    `{ [Symbol.split]() { change(); return []; } }`,
  ],
  replace: [
    textLike("b"),
    `"b", ${textLike("c")}`,
    `"b", ${callback("x", '"c"')}`,
    `{ [Symbol.replace]() { change(); return "r"; } }`,
    `/b/, ${callback("x", '"c"')}`,
    `/b/g, ${callback("x", '"c"')}`,
    `/b/, ${textLike("c")}`,
  ],
  replaceAll: [
    textLike("b"),
    `"b", ${textLike("c")}`,
    `"b", ${callback("x", '"c"')}`,
    `{ [Symbol.replace]() { change(); return "r"; } }`,
    `/b/g, ${callback("x", '"c"')}`,
  ],
  match: [`{ [Symbol.match]() { change(); return null; } }`, textLike("b")],
  matchAll: [`{ [Symbol.matchAll]() { change(); return []; } }`],
  search: [`{ [Symbol.search]() { change(); return 0; } }`, textLike("b")],
  isWellFormed: [""],
}))
  args.forEach((a, i) => add(`string-${m}-${i}`, `"abc".${m}(${a})`));
for (const m of [
  "trim",
  "toUpperCase",
  "toLowerCase",
  "charAt",
  "slice",
  "at",
  "split",
  "padStart",
  "repeat",
  "indexOf",
  "normalize",
  "toString",
  "valueOf",
  "isWellFormed",
  "toWellFormed",
  "localeCompare",
  "trimEnd",
  "codePointAt",
  "substring",
  "anchor",
])
  if (m !== "toString" && m !== "valueOf")
    add(`string-${m}-receiver`, `String.prototype.${m}.call(${textLike("abc")}, 1)`);
add("string-raw-raw", `String.raw(${withGetter("raw", '["a", "b"]')}, 1)`);
add("string-raw-length", `String.raw({ raw: ${withGetter("length", "2", '0: "a", 1: "b"')} }, 1)`);
add("string-raw-element", `String.raw({ raw: { length: 1, get 0() { change(); return "a"; } } })`);
add("string-raw-substitution", `String.raw({ raw: ["a", "b"] }, ${textLike("s")})`);
add("string-fromCharCode", `String.fromCharCode(${numberLike(65)})`);
add("string-fromCodePoint", `String.fromCodePoint(${numberLike(65)})`);
add("string-call", `String(${textLike("s")})`);
add("string-construct", `new String(${textLike("s")}).length`);
add("template", "`${" + textLike("s") + "}`");
add("string-plus", `"" + ${numberLike(1)}`);
add("string-plus-primitive", `"" + ${primitiveLike("1")}`);
add("string-iterator-patched", `[..."ab"].length`);

// Number, Math, BigInt, Symbol, global functions and operators
for (const m of ["toFixed", "toPrecision", "toExponential", "toString"])
  add(`number-${m}`, `(12.5).${m}(${numberLike(m === "toString" ? 10 : 2)})`);
add("number-call", `Number(${numberLike(1)})`);
add("number-construct", `new Number(${numberLike(1)}).valueOf()`);
for (const f of [
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "Number.parseFloat",
  "Number.parseInt",
  "encodeURIComponent",
  "decodeURIComponent",
  "encodeURI",
  "decodeURI",
  "escape",
  "unescape",
  "btoa",
  "atob",
])
  add(`global-${f.replace(".", "-")}`, `${f}(${textLike("1")})`);
add("parseInt-radix", `parseInt("11", ${numberLike(2)})`);
for (const f of [
  "abs",
  "acos",
  "acosh",
  "asin",
  "asinh",
  "atan",
  "atanh",
  "cbrt",
  "ceil",
  "clz32",
  "cos",
  "cosh",
  "exp",
  "expm1",
  "floor",
  "fround",
  "f16round",
  "log",
  "log10",
  "log1p",
  "log2",
  "round",
  "sign",
  "sin",
  "sinh",
  "sqrt",
  "tan",
  "tanh",
  "trunc",
])
  add(`math-${f}`, `Math.${f}(${numberLike(1)})`);
for (const f of ["atan2", "imul", "pow", "max", "min", "hypot"]) {
  add(`math-${f}-first`, `Math.${f}(${numberLike(1)}, 2)`);
  add(`math-${f}-second`, `Math.${f}(NaN, ${numberLike(1)})`);
}
add("math-sumPrecise", `Math.sumPrecise(${iterableWithNext("[1, 2]")})`);
add("bigint-call", `String(BigInt(${numberLike(1)}))`);
add("bigint-asIntN-bits", `String(BigInt.asIntN(${numberLike(8)}, 1n))`);
add("bigint-asIntN-value", `String(BigInt.asIntN(8, ${primitiveLike("1n")}))`);
add("bigint-asUintN-bits", `String(BigInt.asUintN(${numberLike(8)}, 1n))`);
add("bigint-toString-radix", `(10n).toString(${numberLike(10)})`);
add("symbol-call", `Symbol(${textLike("d")}).description`);
add("symbol-for", `Symbol.for(${textLike("d")}).description`);
for (const [n, op] of Object.entries({
  minus: "-",
  times: "*",
  divide: "/",
  rest: "%",
  power: "**",
  shift: "<<",
  and: "&",
  or: "|",
  xor: "^",
  less: "<",
  "less-equal": "<=",
  equal: "==",
  ushift: ">>>",
})) {
  add(`operator-${n}-left`, `(${numberLike(1)}) ${op} 1`);
  add(`operator-${n}-right`, `1 ${op} (${numberLike(1)})`);
}
add("operator-negate", `-(${numberLike(1)})`);
add("operator-plus-unary", `+(${numberLike(1)})`);
add("operator-not", `~(${numberLike(1)})`);
add("operator-increment", `(() => { let x = ${numberLike(1)}; x++; return x; })()`);
add("operator-key", `({ k: 1 })[${textLike("k")}]`);
add("operator-key-store", `(() => { const t = {}; t[${textLike("k")}] = 1; return t.k; })()`);
add("operator-key-arr", `arr[${textLike("0")}]`);
add("operator-key-o", `o[${textLike("b")}]`);
add("operator-in", `(${textLike("k")}) in { k: 1 }`);
add("operator-in-o", `(${textLike("a")}) in o`);
add("operator-delete-key", `delete ({ k: 1 })[${textLike("k")}]`);
add("operator-computed-name", `({ [${textLike("k")}]: 1 }).k`);
add("operator-computed-method", `typeof (class { [${textLike("k")}]() {} }).prototype.k`);
add("operator-instanceof", `({}) instanceof { [Symbol.hasInstance]() { change(); return true; } }`);
add("operator-instanceof-getter", `({}) instanceof ${withGetter("[Symbol.hasInstance]", "() => true")}`);
add(
  "operator-instanceof-prototype",
  `(() => { const F = new Proxy(function () {}, { get(t, k) { change(); return Reflect.get(t, k); } }); const b = F.bind(null); return ({}) instanceof b; })()`,
);
add("switch-strict", `(() => { switch (1) { case 1: change(); return 1; } })()`);

// Date
add("date-construct-value", `new Date(${numberLike(0)}).getTime()`);
add("date-construct-parts", `new Date(2020, ${numberLike(0)}).getFullYear()`);
add("date-construct-primitive", `new Date(${primitiveLike("0")}).getTime()`);
add("date-utc", `Date.UTC(2020, ${numberLike(0)})`);
add("date-parse", `Date.parse(${textLike("2020-01-01T00:00:00Z")})`);
for (const m of [
  "setTime",
  "setMilliseconds",
  "setUTCSeconds",
  "setUTCMinutes",
  "setUTCHours",
  "setUTCDate",
  "setUTCMonth",
  "setUTCFullYear",
  "setYear",
])
  add(`date-${m}`, `new Date(0).${m}(${numberLike(1)})`);
add("date-setUTCHours-later", `new Date(0).setUTCHours(1, 1, ${numberLike(1)})`);
add("date-toJSON-toISOString", `Date.prototype.toJSON.call({ toISOString() { change(); return "iso"; } })`);
add(
  "date-toJSON-primitive",
  `Date.prototype.toJSON.call({ valueOf() { change(); return 1; }, toISOString() { return "iso"; }, toString: undefined })`,
);
add("date-toPrimitive", `Date.prototype[Symbol.toPrimitive].call(${textLike("s")}, "string")`);
add(
  "date-toLocaleString-options",
  `typeof new Date(0).toLocaleDateString("en-US", ${withGetter("timeZone", '"UTC"')})`,
);

// Typed arrays, buffers, DataView, Atomics
add("typedarray-construct-length", `new Uint8Array(${numberLike(2)}).length`);
add("typedarray-construct-iterable", `new Uint8Array(${iterable("[1, 2]")}).length`);
add("typedarray-construct-next", `new Uint8Array(${iterableWithNext("[1, 2]")}).length`);
add("typedarray-construct-arraylike", `new Uint8Array(${withGetter("length", "1", "0: 1")}).length`);
add("typedarray-construct-element", `new Uint8Array([${numberLike(1)}])[0]`);
add("typedarray-construct-offset", `new Uint8Array(new ArrayBuffer(8), ${numberLike(0)}).length`);
add("typedarray-construct-offset-of-buf", `new Uint8Array(buf, ${numberLike(0)}).length`);
add(
  "typedarray-construct-length-of-buf2",
  `(() => { try { return new Uint8Array(buf2, 0, ${numberLike(1)}).length; } catch (e) { return e.constructor.name; } })()`,
);
add("typedarray-from", `Uint8Array.from(${iterableWithNext("[1, 2]")}).length`);
add("typedarray-from-map", `Uint8Array.from([1], ${callback("x", "x")}).length`);
add("typedarray-from-ta-map", `Uint8Array.from(ta, ${callback("x", "x")}).length`);
add("typedarray-of", `Uint8Array.of(${numberLike(1)}).length`);
add("typedarray-store", `(ta[0] = ${numberLike(1)}, 0)`);
add("typedarray-store2", `(ta2[0] = ${numberLike(1)}, 0)`);
for (const [m, args] of Object.entries({
  at: [numberLike(0)],
  fill: [numberLike(1), `1, ${numberLike(0)}`, `1, 0, ${numberLike(1)}`],
  includes: [`1, ${numberLike(0)}`],
  indexOf: [`1, ${numberLike(0)}`],
  lastIndexOf: [`1, ${numberLike(0)}`],
  join: [textLike("-")],
  slice: [numberLike(0), `0, ${numberLike(1)}`],
  subarray: [numberLike(0), `0, ${numberLike(1)}`],
  copyWithin: [`${numberLike(0)}, 1`, `0, ${numberLike(1)}`, `0, 1, ${numberLike(2)}`],
  set: [
    `[${numberLike(1)}]`,
    `[1], ${numberLike(0)}`,
    withGetter("length", "1", "0: 1"),
    `{ length: 1, get 0() { change(); return 1; } }`,
  ],
  with: [`${numberLike(0)}, 1`, `0, ${numberLike(1)}`],
  forEach: [callback("x", "0")],
  map: [callback("x", "0")],
  filter: [callback("x", "true")],
  some: [callback("x", "false")],
  every: [callback("x", "true")],
  find: [callback("x", "false")],
  findIndex: [callback("x", "false")],
  findLast: [callback("x", "false")],
  reduce: [`${callback("a, x", "a")}, 0`],
  reduceRight: [`${callback("a, x", "a")}, 0`],
  sort: [callback("a, b", "0")],
  toSorted: [callback("a, b", "0")],
}))
  args.forEach((a, i) => {
    add(
      `typedarray-${m}-${i}`,
      `(() => { try { return String(ta.${m}(${a})); } catch (e) { return e.constructor.name; } })()`,
    );
    add(
      `typedarray2-${m}-${i}`,
      `(() => { try { return String(ta2.${m}(${a})); } catch (e) { return e.constructor.name; } })()`,
    );
  });
for (const m of ["slice", "subarray", "map", "filter"])
  add(
    `typedarray-${m}-species`,
    `(() => { const t = new Uint8Array(2); t.constructor = { [Symbol.species]: function (...a) { change(); return new Uint8Array(...a); } }; return t.${m}(${m === "map" || m === "filter" ? "x => 1" : "0"}).length; })()`,
  );
add("arraybuffer-construct", `new ArrayBuffer(${numberLike(8)}).byteLength`);
add("arraybuffer-construct-options", `new ArrayBuffer(8, ${withGetter("maxByteLength", "16")}).byteLength`);
add("arraybuffer-slice", `new ArrayBuffer(8).slice(${numberLike(0)}).byteLength`);
add("arraybuffer-slice-of-buf", `buf.slice(${numberLike(0)}).byteLength`);
add(
  "arraybuffer-slice-species",
  `(() => { const b = new ArrayBuffer(8); b.constructor = { [Symbol.species]: function (n) { change(); return new ArrayBuffer(n); } }; return b.slice(0).byteLength; })()`,
);
add(
  "arraybuffer-resize",
  `(() => { const b = new ArrayBuffer(8, { maxByteLength: 16 }); b.resize(${numberLike(4)}); return b.byteLength; })()`,
);
add("arraybuffer-transfer", `new ArrayBuffer(8).transfer(${numberLike(4)}).byteLength`);
for (const k of ["Int8", "Uint8", "Int16", "Uint16", "Int32", "Uint32", "Float32", "Float64", "BigInt64"]) {
  add(`dataview-get${k}`, `String(new DataView(new ArrayBuffer(16)).get${k}(${numberLike(0)}))`);
  add(
    `dataview-set${k}-offset`,
    `new DataView(new ArrayBuffer(16)).set${k}(${numberLike(0)}, ${k.startsWith("Big") ? "1n" : "1"})`,
  );
  add(
    `dataview-set${k}-value`,
    `new DataView(new ArrayBuffer(16)).set${k}(0, ${k.startsWith("Big") ? primitiveLike("1n") : numberLike(1)})`,
  );
}
add(
  "dataview-get-of-buf",
  `(() => { try { return dv.getUint8(${numberLike(0)}); } catch (e) { return e.constructor.name; } })()`,
);
add(
  "dataview-set-of-buf",
  `(() => { try { return dv.setUint8(0, ${numberLike(0)}); } catch (e) { return e.constructor.name; } })()`,
);
add("dataview-construct-offset", `new DataView(new ArrayBuffer(16), ${numberLike(0)}).byteLength`);
add("dataview-construct-length", `new DataView(new ArrayBuffer(16), 0, ${numberLike(1)}).byteLength`);
for (const f of ["add", "and", "exchange", "or", "store", "sub", "xor"]) {
  add(`atomics-${f}-index`, `Atomics.${f}(new Int32Array(2), ${numberLike(0)}, 1)`);
  add(`atomics-${f}-value`, `Atomics.${f}(new Int32Array(2), 0, ${numberLike(1)})`);
}
add("atomics-load", `Atomics.load(new Int32Array(2), ${numberLike(0)})`);
add("atomics-compareExchange", `Atomics.compareExchange(new Int32Array(2), 0, ${numberLike(0)}, ${numberLike(1)})`);
add(
  "atomics-store-ta",
  `(() => { try { return Atomics.store(ta, 0, ${numberLike(1)}); } catch (e) { return e.constructor.name; } })()`,
);

// RegExp
add("regexp-construct-pattern", `new RegExp(${textLike("a")}).source`);
add("regexp-construct-flags", `new RegExp("a", ${textLike("g")}).flags`);
add(
  "regexp-construct-match",
  `RegExp(${withGetter("[Symbol.match]", "true", 'constructor: RegExp, source: "a", flags: ""')})?.source`,
);
add(
  "regexp-construct-source",
  `new RegExp({ [Symbol.match]: true, get source() { change(); return "a"; }, flags: "" }).source`,
);
add("regexp-exec-input", `/a/.exec(${textLike("a")})[0]`);
add("regexp-exec-lastIndex", `(() => { const r = /a/g; r.lastIndex = ${numberLike(0)}; return r.exec("a")[0]; })()`);
add("regexp-test-input", `/a/.test(${textLike("a")})`);
add("regexp-test-lastIndex", `(() => { const r = /a/y; r.lastIndex = ${numberLike(0)}; return r.test("a"); })()`);
add("regexp-test-exec", `(() => { const r = /a/; r.exec = () => { change(); return null; }; return r.test("a"); })()`);
for (const [m, call] of Object.entries({
  match: `"a".match(r)`,
  replace: `"a".replace(r, "b")`,
  search: `"a".search(r)`,
  split: `"a".split(r)`,
  matchAll: `[..."a".matchAll(r)].length`,
})) {
  add(`regexp-${m}-exec`, `(() => { const r = /a/g; r.exec = () => { change(); return null; }; return ${call}; })()`);
  add(
    `regexp-${m}-flags`,
    `(() => { const r = /a/g; Object.defineProperty(r, "flags", { get() { change(); return "g"; } }); return ${call}; })()`,
  );
  add(`regexp-${m}-lastIndex`, `(() => { const r = /a/g; r.lastIndex = ${numberLike(0)}; return ${call}; })()`);
  add(
    `regexp-${m}-global`,
    `(() => { const r = /a/g; Object.defineProperty(r, "global", { get() { change(); return true; } }); return ${call}; })()`,
  );
}
add(
  "regexp-split-species",
  `(() => { const r = /a/; r.constructor = { [Symbol.species]: function (p, f) { change(); return new RegExp(p, f); } }; return "bab".split(r); })()`,
);
add(
  "regexp-matchAll-species",
  `(() => { const r = /a/g; r.constructor = { [Symbol.species]: function (p, f) { change(); return new RegExp(p, f); } }; return [..."bab".matchAll(r)].length; })()`,
);
add(
  "regexp-replace-result-getter",
  `(() => { const r = /a/; r.exec = () => ({ get index() { change(); return 0; }, length: 1, 0: "a" }); return "a".replace(r, "b"); })()`,
);
add("regexp-replace-named-groups", `"a".replace(/(?<n>a)/, ${callback("...x", '"c"')})`);
add("regexp-toString-source", `RegExp.prototype.toString.call(${withGetter("source", '"a"', 'flags: "g"')})`);
add(
  "regexp-flags-getter",
  `Object.getOwnPropertyDescriptor(RegExp.prototype, "flags").get.call(${withGetter("global", "true")})`,
);

// JSON
add("json-stringify-toJSON", `JSON.stringify({ toJSON() { change(); return 1; } })`);
add("json-stringify-nested-toJSON", `JSON.stringify({ k: { toJSON() { change(); return 1; } } })`);
add("json-stringify-getter", `JSON.stringify(${withGetter("k", "1")})`);
add("json-stringify-replacer", `JSON.stringify({ k: 1 }, ${callback("k, x", "x")})`);
add("json-stringify-replacer-list", `JSON.stringify({ k: 1 }, [new String("k")])`);
add(
  "json-stringify-replacer-list-wrapper",
  `(() => { const k = new String("k"); k.toString = () => { change(); return "k"; }; return JSON.stringify({ k: 1 }, [k]); })()`,
);
add(
  "json-stringify-space-wrapper",
  `(() => { const n = new Number(1); n.valueOf = () => { change(); return 1; }; return JSON.stringify({ k: 1 }, null, n); })()`,
);
add(
  "json-stringify-number-wrapper",
  `(() => { const n = new Number(1); n.valueOf = () => { change(); return 1; }; return JSON.stringify([n]); })()`,
);
add(
  "json-stringify-string-wrapper",
  `(() => { const n = new String("s"); n.toString = () => { change(); return "t"; }; return JSON.stringify([n]); })()`,
);
add("json-stringify-o", `JSON.stringify([{ toJSON() { change(); return 1; } }, o, arr])`);
add("json-stringify-o-first", `JSON.stringify([o, arr, { toJSON() { change(); return 1; } }, o, arr])`);
add("json-stringify-proxy", `JSON.stringify(new Proxy({ k: 1 }, { get(t, k) { change(); return t[k]; } }))`);
add("json-stringify-proxy-ownKeys", `JSON.stringify(new Proxy({ k: 1 }, { ownKeys(t) { change(); return ["k"]; } }))`);
add("json-parse-text", `JSON.parse(${textLike("1")})`);
add("json-parse-reviver", `JSON.parse("[1]", ${callback("k, x", "x")})`);
add(
  "json-parse-reviver-this",
  `JSON.parse('{"a":1,"b":[1,2]}', function (k, x) { change(); if (k === "a") delete this.b; return x; })`,
);

// Object
add("object-assign-getter", `Object.assign({}, ${withGetter("k", "1")})`);
add("object-assign-setter", `Object.assign({ set k(x) { change(); } }, { k: 1 })`);
add("object-assign-to-o", `Object.assign(o, ${withGetter("b", "5")}).b`);
add("object-assign-from-o", `Object.assign({ set a(x) { change(); }, set b(x) {}, set f(x) {}, set z(x) {} }, o) && 0`);
add("object-assign-proxy", `Object.assign({}, new Proxy({ k: 1 }, { ownKeys(t) { change(); return ["k"]; } }))`);
add("object-spread-getter", `({ ...${withGetter("k", "1")} })`);
add("object-spread-o", `({ ...${withGetter("k", "1")}, ...o }).b`);
add("object-rest-getter", `(() => { const { ...r } = ${withGetter("k", "1")}; return r; })()`);
add("object-destructure-getter", `(() => { const { k } = ${withGetter("k", "1")}; return k; })()`);
add("object-create-descriptors", `Object.create(null, { k: ${withGetter("value", "1")} }).k`);
add("object-create-descriptor-map", `Object.create(null, ${withGetter("k", "({ value: 1 })")}).k`);
for (const f of ["value", "get", "set", "enumerable", "configurable", "writable"])
  add(
    `object-defineProperty-${f}`,
    `Object.defineProperty({}, "k", ${withGetter(f, f === "get" || f === "set" ? "undefined" : f === "value" ? "1" : "true")}) && 0`,
  );
add("object-defineProperty-key", `Object.defineProperty({}, ${textLike("k")}, { value: 1 }).k`);
add("object-defineProperty-inherited", `Object.defineProperty({}, "k", Object.create(${withGetter("value", "1")})).k`);
add(
  "object-defineProperty-on-o",
  `Object.defineProperty(o, "b", ${withGetter("value", "5", "writable: true, configurable: true, enumerable: true")}).b`,
);
add("object-defineProperties", `Object.defineProperties({}, { k: ${withGetter("value", "1")} }).k`);
add(
  "object-defineProperties-proxy",
  `Object.defineProperties({}, new Proxy({ k: { value: 1 } }, { get(t, k) { change(); return t[k]; } })).k`,
);
for (const f of [
  "keys",
  "values",
  "entries",
  "getOwnPropertyNames",
  "getOwnPropertyDescriptors",
  "getOwnPropertySymbols",
  "freeze",
  "seal",
  "preventExtensions",
  "isFrozen",
  "isSealed",
  "isExtensible",
  "getPrototypeOf",
]) {
  const trap =
    {
      preventExtensions: "preventExtensions(t) { change(); return Reflect.preventExtensions(t); }",
      isExtensible: "isExtensible(t) { change(); return Reflect.isExtensible(t); }",
      getPrototypeOf: "getPrototypeOf(t) { change(); return null; }",
      isFrozen: "isExtensible(t) { change(); return Reflect.isExtensible(t); }",
      isSealed: "isExtensible(t) { change(); return Reflect.isExtensible(t); }",
    }[f] ?? "ownKeys(t) { change(); return Reflect.ownKeys(t); }";
  add(`object-${f}-proxy`, `Object.${f}(new Proxy({ k: 1 }, { ${trap} })) && 0`);
}
add("object-values-getter", `Object.values(${withGetter("k", "1")})`);
add("object-entries-getter", `Object.entries(${withGetter("k", "1")})`);
add("object-values-getter-then-o", `Object.values({ get k() { change(); return 1; }, l: 2 })`);
add(
  "object-entries-of-o",
  `(() => { const t = { get k() { change(); return 1; }, l: o }; return Object.entries(t).length; })()`,
);
add("object-fromEntries-iterable", `Object.fromEntries(${iterableWithNext('[["k", 1]]')})`);
add("object-fromEntries-entry", `Object.fromEntries([${withGetter("0", '"k"', "1: 1")}])`);
add("object-fromEntries-key", `Object.fromEntries([[${textLike("k")}, 1]])`);
add("object-groupBy", `Object.groupBy([1], ${callback("x", '"k"')})`);
add("object-groupBy-key", `Object.groupBy([1], x => (${textLike("k")}))`);
add("object-groupBy-arr", `Object.keys(Object.groupBy(arr, ${callback("x", '"k"')}))`);
add("map-groupBy", `Map.groupBy([1], ${callback("x", '"k"')}).size`);
add("object-hasOwn-key", `Object.hasOwn({}, ${textLike("k")})`);
add("object-hasOwn-key-o", `Object.hasOwn(o, ${textLike("a")})`);
add("object-hasOwnProperty-key", `({}).hasOwnProperty(${textLike("k")})`);
add("object-hasOwnProperty-key-o", `o.hasOwnProperty(${textLike("a")})`);
add("object-propertyIsEnumerable-key", `o.propertyIsEnumerable(${textLike("a")})`);
add("object-getOwnPropertyDescriptor-key", `Object.getOwnPropertyDescriptor(o, ${textLike("b")})?.value`);
add("object-toString-tag", `Object.prototype.toString.call(${withGetter("[Symbol.toStringTag]", '"T"')})`);
add("object-toLocaleString", `Object.prototype.toLocaleString.call(${textLike("s")})`);
add(
  "object-isPrototypeOf-proxy",
  `Object.prototype.isPrototypeOf.call({}, new Proxy({}, { getPrototypeOf(t) { change(); return null; } }))`,
);
add(
  "object-setPrototypeOf-proxy",
  `Object.setPrototypeOf(new Proxy({}, { setPrototypeOf(t, p) { change(); return true; } }), null) && 0`,
);
add("object-defineGetter-key", `({}).__defineGetter__(${textLike("k")}, () => 1)`);
add("object-lookupGetter-key", `({}).__lookupGetter__(${textLike("k")})`);
add(
  "object-lookupGetter-proxy",
  `new Proxy({}, { getOwnPropertyDescriptor(t, k) { change(); return undefined; } }).__lookupGetter__("k")`,
);
add(
  "object-proto-set-proxy",
  `(new Proxy({}, { setPrototypeOf(t, p) { change(); return true; } }).__proto__ = null, 0)`,
);

// Reflect, Function, Proxy
add("reflect-apply-list", `Reflect.apply(Math.max, null, ${withGetter("length", "1", "0: 1")})`);
add("reflect-apply-element", `Reflect.apply(Math.max, null, { length: 1, get 0() { change(); return 1; } })`);
add("reflect-construct-list", `Reflect.construct(Object, ${withGetter("length", "0")}) && 0`);
add(
  "reflect-construct-newTarget",
  `(() => { const nt = new Proxy(function () {}, { get(t, k) { change(); return t[k]; } }); return Reflect.construct(Object, [], nt) && 0; })()`,
);
for (const K of [
  "Array",
  "Map",
  "Set",
  "Date",
  "RegExp",
  "Error",
  "Promise",
  "Uint8Array",
  "ArrayBuffer",
  "Number",
  "String",
  "Boolean",
  "WeakMap",
  "WeakSet",
  "DataView",
  "WeakRef",
  "Function",
]) {
  const a = { Promise: "[() => {}]", DataView: "[new ArrayBuffer(1)]", WeakRef: "[{}]" }[K] ?? "[]";
  add(
    `reflect-construct-newTarget-${K}`,
    `(() => { const nt = new Proxy(function () {}, { get(t, k) { change(); return t[k]; } }); return Reflect.construct(${K}, ${a}, nt) && 0; })()`,
  );
}
add("reflect-get-receiver", `Reflect.get({ get k() { change(); return this; } }, "k", o) === o`);
add("reflect-get-key", `Reflect.get(o, ${textLike("b")})`);
add("reflect-set-setter", `Reflect.set({ set k(x) { change(); } }, "k", 1, o)`);
add("reflect-set-key", `Reflect.set({}, ${textLike("b")}, 1)`);
add("reflect-has-key", `Reflect.has(o, ${textLike("a")})`);
add("reflect-deleteProperty-key", `Reflect.deleteProperty({}, ${textLike("a")})`);
add("reflect-defineProperty-descriptor", `Reflect.defineProperty({}, "k", ${withGetter("value", "1")})`);
add("reflect-ownKeys-proxy", `Reflect.ownKeys(new Proxy({}, { ownKeys() { change(); return []; } }))`);
add("function-apply-list", `Math.max.apply(null, ${withGetter("length", "1", "0: 1")})`);
add("function-apply-element", `Math.max.apply(null, { length: 1, get 0() { change(); return 1; } })`);
add("function-apply-user", `(function (x) { return x; }).apply(null, { length: 1, get 0() { change(); return 1; } })`);
add(
  "function-bind-length",
  `(() => { const f = function () {}; Object.defineProperty(f, "length", { get() { change(); return 1; } }); return f.bind(null).length; })()`,
);
add(
  "function-bind-name",
  `(() => { const f = function () {}; Object.defineProperty(f, "name", { get() { change(); return "n"; } }); return f.bind(null).name; })()`,
);
add(
  "function-bind-proxy",
  `typeof Function.prototype.bind.call(new Proxy(function () {}, { getOwnPropertyDescriptor(t, k) { change(); return Reflect.getOwnPropertyDescriptor(t, k); } }), null)`,
);
add(
  "function-hasInstance-prototype",
  `Function.prototype[Symbol.hasInstance].call(new Proxy(function () {}, { get(t, k) { change(); return t[k]; } }), {})`,
);
add("function-call-bound", `(function () { change(); return 1; }).bind(null)()`);
add("function-call-call", `(function () { change(); return 1; }).call(null)`);
add("function-call-call-call", `Function.prototype.call.call(function () { change(); return 1; }, null)`);
add("function-apply-apply", `Function.prototype.apply.call(function () { change(); return 1; }, null, [])`);
add("reflect-apply-user", `Reflect.apply(function () { change(); return 1; }, null, [])`);
add("reflect-construct-user", `Reflect.construct(function () { change(); }, []) && 0`);
add("reflect-apply-bound", `Reflect.apply((function () { change(); return 1; }).bind(null), null, [])`);
for (const [trap, use] of Object.entries({
  get: "p.k",
  set: "(p.k = 1)",
  has: '"k" in p',
  deleteProperty: "delete p.k",
  ownKeys: "Object.keys(p)",
  getOwnPropertyDescriptor: 'Object.getOwnPropertyDescriptor(p, "k")',
  defineProperty: 'Object.defineProperty(p, "k", { value: 1, configurable: true }) && 0',
  getPrototypeOf: "Object.getPrototypeOf(p) && 0",
  setPrototypeOf: "Object.setPrototypeOf(p, null) && 0",
  isExtensible: "Object.isExtensible(p)",
  preventExtensions: "Object.preventExtensions(p) && 0",
}))
  add(
    `proxy-${trap}`,
    `(() => { const p = new Proxy({}, { ${trap}(...a) { change(); return Reflect.${trap}(...a); } }); return ${use}; })()`,
  );
add("proxy-apply", `new Proxy(function () {}, { apply() { change(); return 1; } })()`);
add("proxy-construct", `new (new Proxy(function () {}, { construct() { change(); return {}; } }))() && 0`);
add("proxy-get-inherited", `Object.create(new Proxy({}, { get() { change(); return 1; } })).k`);
add("proxy-set-inherited", `(Object.create(new Proxy({}, { set() { change(); return true; } })).k = 1)`);
add("proxy-has-inherited", `"k" in Object.create(new Proxy({}, { has() { change(); return true; } }))`);
add("proxy-handler-getter", `new Proxy({}, ${withGetter("get", "undefined")}).k`);
add(
  "proxy-for-in",
  `(() => { let n = 0; for (const k in new Proxy({ k: 1 }, { ownKeys(t) { change(); return ["k"]; } })) n++; return n; })()`,
);
add("proxy-array-concat", `[].concat(new Proxy([1], { get(t, k) { change(); return t[k]; } }))`);
add("proxy-array-json", `JSON.stringify(new Proxy([1], { get(t, k) { change(); return t[k]; } }))`);

// Map, Set, WeakMap, iterators
add("map-construct-iterable", `new Map(${iterableWithNext('[["k", 1]]')}).size`);
add("map-construct-entry", `new Map([${withGetter("0", '"k"', "1: 1")}]).size`);
add(
  "map-construct-adder",
  `(() => { class M extends Map { set(k, x) { change(); return super.set(k, x); } } return new M([["k", 1]]).size; })()`,
);
add(
  "map-construct-adder-getter",
  `(() => { class M extends Map { get set() { change(); return super.set; } } return new M([["k", 1]]).size; })()`,
);
add("set-construct-iterable", `new Set(${iterableWithNext("[1]")}).size`);
add(
  "set-construct-adder",
  `(() => { class S extends Set { add(x) { change(); return super.add(x); } } return new S([1]).size; })()`,
);
add(
  "weakmap-construct-adder",
  `(() => { class M extends WeakMap { set(k, x) { change(); return super.set(k, x); } } return new M([[{}, 1]]) && 0; })()`,
);
add(
  "weakset-construct-adder",
  `(() => { class S extends WeakSet { add(x) { change(); return super.add(x); } } return new S([{}]) && 0; })()`,
);
add("map-forEach", `m.forEach(${callback("x", "0")})`);
add("set-forEach", `st.forEach(${callback("x", "0")})`);
add("map-for-of", `(() => { let n = 0; for (const [k, x] of m) { change(); n++; } return n; })()`);
add("set-for-of", `(() => { let n = 0; for (const x of st) { change(); n++; } return n; })()`);
add(
  "map-getOrInsertComputed",
  `typeof m.getOrInsertComputed === "function" ? m.getOrInsertComputed("q" + hits, ${callback("k", "1")}) : change()`,
);
for (const f of [
  "union",
  "intersection",
  "difference",
  "symmetricDifference",
  "isSubsetOf",
  "isSupersetOf",
  "isDisjointFrom",
]) {
  add(
    `set-${f}-size`,
    `st.${f}({ get size() { change(); return 1; }, has() { return true; }, keys() { return [1][Symbol.iterator](); } }) && 0`,
  );
  add(
    `set-${f}-size-valueOf`,
    `st.${f}({ size: ${numberLike(1)}, has() { return true; }, keys() { return [1][Symbol.iterator](); } }) && 0`,
  );
  add(
    `set-${f}-has`,
    `st.${f}({ size: 100, has() { change(); return true; }, keys() { change(); return [1][Symbol.iterator](); } }) && 0`,
  );
  add(
    `set-${f}-keys`,
    `st.${f}({ size: 1, has() { change(); return true; }, keys() { change(); return { next() { change(); return { done: true }; } }; } }) && 0`,
  );
}
for (const [f, a] of Object.entries({
  map: "x => x",
  filter: "x => true",
  take: "1",
  drop: "0",
  flatMap: "x => [x]",
  toArray: "",
  forEach: "x => {}",
  some: "x => false",
  every: "x => true",
  find: "x => false",
  reduce: "(a, x) => a, 0",
})) {
  add(
    `iterator-${f}-next`,
    `(() => { const r = Iterator.from({ next() { change(); return { done: true }; } }).${f}(${a}); return r && typeof r.next === "function" ? r.next().done : r; })()`,
  );
}
for (const [f, r] of Object.entries({
  map: "x",
  filter: "true",
  flatMap: "[x]",
  forEach: "0",
  some: "false",
  every: "true",
  find: "false",
}))
  add(
    `iterator-${f}-callback`,
    `(() => { const r = arr.values().${f}(${callback("x", r)}); return r && typeof r.next === "function" ? [...r].length : r; })()`,
  );
add("iterator-take-limit", `[1].values().take(${numberLike(1)}).next().value`);
add("iterator-drop-limit", `[1].values().drop(${numberLike(0)}).next().value`);
add(
  "iterator-take-return",
  `(() => { const r = Iterator.from({ next() { return { done: false, value: 1 }; }, return() { change(); return {}; } }).take(1); r.next(); return r.next().done; })()`,
);
add("iterator-from-getter", `Iterator.from(${withGetter("next", "() => ({ done: true })")}).next().done`);
add("iterator-from-iterable", `Iterator.from(${iterable("[1]")}).next().value`);
add(
  "iterator-result-done-getter",
  `[...{ [Symbol.iterator]() { return { next() { return { get done() { change(); return true; } }; } }; } }].length`,
);
add(
  "iterator-result-value-getter",
  `(() => { let n = 0; return [...{ [Symbol.iterator]() { return { next() { return n++ ? { done: true } : { done: false, get value() { change(); return 1; } }; } }; } }].length; })()`,
);
add("generator-next", `(function* () { change(); yield 1; })().next().value`);
add(
  "generator-return-finally",
  `(() => { const g = (function* () { try { yield 1; } finally { change(); } })(); g.next(); return g.return(2).value; })()`,
);
add("generator-spread", `[...(function* () { change(); yield 1; })()].length`);
add("yield-star", `[...(function* () { yield* ${iterableWithNext("[1]")}; })()].length`);
add("array-iterator-of-arr", `(() => { let n = 0; for (const x of arr) { change(); n++; } return n; })()`);
add(
  "array-entries-of-arr",
  `(() => { let n = 0; for (const [i, x] of arr.entries()) { change(); n++; } return n; })()`,
);
add("for-in-of-o", `(() => { let n = ""; for (const k in o) { change(); n += k; } return n; })()`);

// Error
add("error-message", `new Error(${textLike("m")}).message`);
add("error-cause-getter", `new Error("m", ${withGetter("cause", "1")}).cause`);
add("error-cause-proxy", `new Error("m", new Proxy({}, { has(t, k) { change(); return false; } })).cause`);
add("error-toString-name", `Error.prototype.toString.call(${withGetter("name", '"N"', 'message: "m"')})`);
add("error-toString-message", `Error.prototype.toString.call({ name: "N", message: ${textLike("m")} })`);
add("aggregate-error-iterable", `new AggregateError(${iterableWithNext("[1]")}).errors.length`);
add("error-captureStackTrace-o", `(Error.captureStackTrace(o), change(), typeof o.stack)`);
add(
  "error-prepareStackTrace",
  `(() => { const old = Error.prepareStackTrace; Error.prepareStackTrace = () => { change(); return "s"; }; const s = new Error("m").stack; Error.prepareStackTrace = old; return s; })()`,
);
add("type-error-message", `new TypeError(${textLike("m")}).message`);
add("suppressed-error-message", `new SuppressedError(1, 2, ${textLike("m")}).message`);
add("domexception-message", `new DOMException(${textLike("m")}, ${textLike("n")}).message`);

// The host: web classes, console, Bun, Buffer, process, Intl
add("structuredClone-getter", `structuredClone(${withGetter("k", "1")})`);
add("structuredClone-nested", `structuredClone({ a: ${withGetter("k", "1")}, o, arr }).arr.length`);
add("structuredClone-transfer", `structuredClone(1, ${withGetter("transfer", "[]")})`);
add("url-construct", `new URL(${textLike("http://a/")}).href`);
add("url-construct-base", `new URL("/x", ${textLike("http://a/")}).href`);
add("url-canParse", `URL.canParse(${textLike("http://a/")})`);
add("url-set-href", `(() => { const u = new URL("http://a/"); u.pathname = ${textLike("/p")}; return u.href; })()`);
add("urlsearchparams-record", `new URLSearchParams(${withGetter("k", '"1"')}).toString()`);
add("urlsearchparams-iterable", `new URLSearchParams(${iterableWithNext('[["k", "1"]]')}).toString()`);
add("urlsearchparams-pair", `new URLSearchParams([${iterableWithNext('["k", "1"]')}]).toString()`);
add("urlsearchparams-value", `new URLSearchParams({ k: ${textLike("1")} }).toString()`);
add(
  "urlsearchparams-append",
  `(() => { const u = new URLSearchParams(); u.append(${textLike("k")}, ${textLike("1")}); return u.toString(); })()`,
);
add("urlsearchparams-forEach", `new URLSearchParams("a=1").forEach(${callback("x", "0")})`);
add("headers-record", `new Headers(${withGetter("k", '"1"')}).withGetter("k")`);
add("headers-iterable", `new Headers(${iterableWithNext('[["k", "1"]]')}).withGetter("k")`);
add("headers-value", `new Headers({ k: ${textLike("1")} }).withGetter("k")`);
add(
  "headers-set",
  `(() => { const h = new Headers(); h.set(${textLike("k")}, ${textLike("1")}); return h.withGetter("k"); })()`,
);
add("headers-forEach", `new Headers({ a: "1" }).forEach(${callback("x", "0")})`);
add(
  "formdata-forEach",
  `(() => { const f = new FormData(); f.append("a", "1"); return f.forEach(${callback("x", "0")}); })()`,
);
add(
  "formdata-append",
  `(() => { const f = new FormData(); f.append(${textLike("a")}, ${textLike("1")}); return f.withGetter("a"); })()`,
);
add("response-init-status", `new Response("", ${withGetter("status", "201")}).status`);
add("response-init-headers", `new Response("", { headers: ${withGetter("k", '"1"')} }).headers.withGetter("k")`);
add("response-init-statusText", `new Response("", { statusText: ${textLike("t")} }).statusText`);
add("response-json", `Response.json({ toJSON() { change(); return 1; } }).status`);
add("response-json-getter", `Response.json(${withGetter("k", "1")}).status`);
add("response-redirect", `Response.redirect(${textLike("http://a/")}).status`);
add("request-url", `new Request(${textLike("http://a/")}).url`);
add("request-init-method", `new Request("http://a/", ${withGetter("method", '"POST"')}).method`);
add("request-init-method-value", `new Request("http://a/", { method: ${textLike("POST")} }).method`);
add("blob-parts-iterable", `new Blob(${iterableWithNext('["a"]')}).size`);
add("blob-part-toString", `new Blob([${textLike("a")}]).size`);
add("blob-options-type", `new Blob([], ${withGetter("type", '"t/t"')}).type`);
add("blob-slice", `new Blob(["abc"]).slice(${numberLike(0)}).size`);
add("file-name", `new File([], ${textLike("n")}).name`);
add("textdecoder-label", `new TextDecoder(${textLike("utf-8")}).encoding`);
add("textdecoder-options", `new TextDecoder("utf-8", ${withGetter("fatal", "true")}).fatal`);
add(
  "textdecoder-decode-options",
  `new TextDecoder().decode(new Uint8Array(1), ${withGetter("stream", "false")}).length`,
);
add("textencoder-encode", `new TextEncoder().encode(${textLike("a")}).length`);
add("textencoder-encodeInto", `new TextEncoder().encodeInto(${textLike("a")}, new Uint8Array(2)).written`);
add(
  "textencoder-encodeInto-ta",
  `(() => { try { return new TextEncoder().encodeInto(${textLike("a")}, ta).written; } catch (e) { return e.constructor.name; } })()`,
);
add("event-init", `new Event("e", ${withGetter("bubbles", "true")}).bubbles`);
add("event-type", `new Event(${textLike("e")}).type`);
add("customevent-detail", `new CustomEvent("e", ${withGetter("detail", "1")}).detail`);
add(
  "eventtarget-dispatch",
  `(() => { const t = new EventTarget(); t.addEventListener("e", ${callback("e", "0")}); return t.dispatchEvent(new Event("e")); })()`,
);
add(
  "eventtarget-handleEvent",
  `(() => { const t = new EventTarget(); t.addEventListener("e", { handleEvent() { change(); } }); return t.dispatchEvent(new Event("e")); })()`,
);
add(
  "eventtarget-handleEvent-getter",
  `(() => { const t = new EventTarget(); t.addEventListener("e", ${withGetter("handleEvent", "() => {}")}); return t.dispatchEvent(new Event("e")); })()`,
);
add(
  "eventtarget-options",
  `(() => { const t = new EventTarget(); t.addEventListener("e", () => {}, ${withGetter("once", "true")}); return 0; })()`,
);
add(
  "abortsignal-onabort",
  `(() => { const a = new AbortController(); a.signal.onabort = ${callback("e", "0")}; a.abort(); return a.signal.aborted; })()`,
);
add(
  "abortsignal-listener",
  `(() => { const a = new AbortController(); a.signal.addEventListener("abort", ${callback("e", "0")}); a.abort(); return a.signal.aborted; })()`,
);
add("abortsignal-any", `AbortSignal.any(${iterableWithNext("[]")}).aborted`);
add(
  "console-log-inspect-custom",
  `console.log({ [Symbol.for("nodejs.util.inspect.custom")]() { change(); return "c"; } })`,
);
add("console-log-getter", `console.log(${withGetter("k", "1")})`);
add("console-log-format-s", `console.log("%s", ${textLike("s")})`);
add("console-log-format-d", `console.log("%d", ${numberLike(1)})`);
add("console-log-format-first", `console.log(${textLike("s")})`);
add(
  "console-log-proxy",
  `console.log(new Proxy({ k: 1 }, { get(t, k) { change(); return t[k]; }, ownKeys(t) { change(); return Reflect.ownKeys(t); } }))`,
);
add("console-log-tag", `console.log(${withGetter("[Symbol.toStringTag]", '"T"')})`);
add("console-log-class-name", `console.log(new (class K { static get name() { change(); return "N"; } })())`);
add(
  "console-log-error-getters",
  `console.log(Object.assign(Object.create(Error.prototype), ${withGetter("message", '"m"')}) instanceof Error)`,
);
add("console-count-label", `console.count(${textLike("l")})`);
add("console-table", `console.table([${withGetter("k", "1")}])`);
add("console-group", `(console.group(${textLike("g")}), console.groupEnd())`);
add("console-assert", `console.assert(true, ${textLike("g")})`);
add("bun-inspect-custom", `Bun.inspect({ [Bun.inspect.custom]() { change(); return "c"; } })`);
add("bun-inspect-getter", `Bun.inspect(${withGetter("k", "1")})`);
add("bun-inspect-options", `Bun.inspect({}, ${withGetter("depth", "1")})`);
add("bun-deepEquals-getter", `Bun.deepEquals(${withGetter("k", "1")}, { k: 1 })`);
add(
  "bun-deepEquals-proxy",
  `Bun.deepEquals(new Proxy({ k: 1 }, { get(t, k) { change(); return t[k]; }, ownKeys(t) { change(); return Reflect.ownKeys(t); } }), { k: 1 })`,
);
add("bun-deepEquals-o", `Bun.deepEquals({ x: ${withGetter("k", "1")}, o }, { x: { k: 1 }, o })`);
add("bun-deepMatch-getter", `Bun.deepMatch(${withGetter("k", "1")}, { k: 1 })`);
add("bun-escapeHTML", `Bun.escapeHTML(${textLike("<")})`);
add("bun-stringWidth", `Bun.stringWidth(${textLike("a")})`);
add("bun-stripANSI", `Bun.stripANSI(${textLike("a")})`);
add("bun-hash", `typeof Bun.hash(${textLike("a")})`);
add("bun-semver", `Bun.semver.satisfies(${textLike("1.0.0")}, ${textLike("*")})`);
add("bun-semver-order", `Bun.semver.order(${textLike("1.0.0")}, ${textLike("1.0.1")})`);
add("bun-color", `Bun.color(${textLike("red")}, "hex")`);
add("bun-file", `typeof Bun.file(${textLike("/nowhere")}).name`);
add("bun-concatArrayBuffers", `Bun.concatArrayBuffers(${iterableWithNext("[new Uint8Array(1)]")}).byteLength`);
add("bun-pathToFileURL", `Bun.pathToFileURL(${textLike("/a")}).href`);
add("bun-fileURLToPath", `Bun.fileURLToPath(${textLike("file:///a")})`);
add("bun-toml", `Bun.TOML.parse(${textLike("a = 1")}).a`);
add("bun-yaml-parse", `Bun.YAML.parse(${textLike("a: 1")}).a`);
add("bun-yaml-stringify-getter", `Bun.YAML.stringify(${withGetter("k", "1")})`);
add("bun-yaml-stringify-toJSON", `Bun.YAML.stringify({ toJSON() { change(); return 1; } })`);
add("bun-glob", `new Bun.Glob(${textLike("*.a")}).match(${textLike("x.a")})`);
add("bun-cookie", `new Bun.Cookie(${textLike("a")}, ${textLike("b")}).name`);
add("bun-cookie-options", `new Bun.Cookie("a", "b", ${withGetter("path", '"/p"')}).path`);
add("bun-cookiemap-record", `new Bun.CookieMap(${withGetter("k", '"1"')}).withGetter("k")`);
add("bun-cookiemap-forEach", `new Bun.CookieMap({ a: "1" }).forEach(${callback("x", "0")})`);
add("bun-indexOfLine", `Bun.indexOfLine(new Uint8Array(2), ${numberLike(0)})`);
add("bun-randomUUIDv7", `typeof Bun.randomUUIDv7("hex", ${numberLike(0)})`);
add("bun-gzipSync-options", `Bun.gzipSync(new Uint8Array(1), ${withGetter("level", "1")}).length > 0`);
add("bun-cryptohasher-update", `new Bun.CryptoHasher("sha1").update(${textLike("a")}).digest("hex")`);
add("bun-sha", `typeof Bun.SHA1.hash(${textLike("a")}, "hex")`);
add("bun-peek", `Bun.peek({ then() { change(); } }) && 0`);
add("bun-inspect-table", `Bun.inspect.table([${withGetter("k", "1")}]).length > 0`);
add("buffer-from-valueOf", `Buffer.from({ valueOf() { change(); return "ab"; } }).length`);
add("buffer-from-toPrimitive", `Buffer.from(${primitiveLike('"ab"')}).length`);
add("buffer-from-arraylike", `Buffer.from(${withGetter("length", "1", "0: 1")}).length`);
add("buffer-from-element", `Buffer.from([${numberLike(1)}])[0]`);
add("buffer-from-offset", `Buffer.from(new ArrayBuffer(4), ${numberLike(0)}).length`);
add(
  "buffer-from-encoding",
  `(() => { try { return Buffer.from("ab", ${textLike("utf8")}).length; } catch (e) { return e.constructor.name; } })()`,
);
add(
  "buffer-alloc-fill",
  `(() => { try { return Buffer.alloc(2, ${numberLike(1)})[0]; } catch (e) { return e.constructor.name; } })()`,
);
add(
  "buffer-concat-list",
  `(() => { try { return Buffer.concat(${iterableWithNext("[Buffer.alloc(1)]")}).length; } catch (e) { return e.constructor.name; } })()`,
);
add(
  "buffer-concat-length",
  `(() => { try { return Buffer.concat([Buffer.alloc(1)], ${numberLike(1)}).length; } catch (e) { return e.constructor.name; } })()`,
);
for (const [m, a] of Object.entries({
  toString: [`"utf8", ${numberLike(0)}`, `${textLike("utf8")}`],
  write: [`${textLike("a")}`, `"a", ${numberLike(0)}`],
  fill: [`${numberLike(1)}`, `1, ${numberLike(0)}`, `${textLike("a")}`],
  indexOf: [`${numberLike(1)}`, `1, ${numberLike(0)}`, `${textLike("a")}`],
  includes: [`1, ${numberLike(0)}`],
  readUInt8: [numberLike(0)],
  writeUInt8: [`${numberLike(1)}, 0`, `1, ${numberLike(0)}`],
  readInt32LE: [numberLike(0)],
  writeInt32LE: [`${numberLike(1)}, 0`, `1, ${numberLike(0)}`],
  writeDoubleLE: [`${numberLike(1)}, 0`],
  readUIntBE: [`${numberLike(0)}, 1`, `0, ${numberLike(1)}`],
  slice: [numberLike(0)],
  subarray: [numberLike(0)],
  copy: [`Buffer.alloc(8), ${numberLike(0)}`],
  compare: [`Buffer.alloc(8), ${numberLike(0)}`],
  equals: [`Buffer.alloc(8)`],
  swap16: [""],
}))
  a.forEach(
    (x, i) =>
      x.includes("change()") &&
      add(
        `buffer-${m}-${i}`,
        `(() => { try { return String(Buffer.alloc(8).${m}(${x})); } catch (e) { return e.constructor.name + (e.code ?? ""); } })()`,
      ),
  );
add(
  "buffer-byteLength",
  `(() => { try { return Buffer.byteLength(${textLike("a")}); } catch (e) { return e.constructor.name; } })()`,
);
add("buffer-isEncoding", `Buffer.isEncoding(${textLike("utf8")})`);
add(
  "buffer-compare",
  `(() => { try { return Buffer.compare(${numberLike(1)}, Buffer.alloc(1)); } catch (e) { return e.constructor.name; } })()`,
);
add(
  "process-hrtime",
  `(() => { try { return typeof process.hrtime(${withGetter("0", "0", "1: 0, length: 2")}); } catch (e) { return e.constructor.name; } })()`,
);
add("process-emit", `(() => { process.once("first", ${callback("x", "0")}); return process.emit("first", 1); })()`);
add("performance-mark", `performance.mark(${textLike("m")}).name`);
add("performance-mark-options", `performance.mark("m", ${withGetter("detail", "1")}).detail`);
add("intl-numberformat-options", `new Intl.NumberFormat("en", ${withGetter("style", '"decimal"')}).format(1)`);
add("intl-numberformat-locales", `new Intl.NumberFormat(${withGetter("length", "1", '0: "en"')}).format(1)`);
add("intl-numberformat-format", `new Intl.NumberFormat("en").format(${numberLike(1)})`);
add(
  "intl-datetimeformat-options",
  `typeof new Intl.DateTimeFormat("en", ${withGetter("timeZone", '"UTC"')}).format(0)`,
);
add("intl-collator-compare", `new Intl.Collator("en").compare(${textLike("a")}, "a")`);
add("intl-pluralrules-select", `new Intl.PluralRules("en").select(${numberLike(1)})`);
add("intl-listformat-format", `new Intl.ListFormat("en").format(${iterableWithNext('["a"]')})`);
add("intl-segmenter-segment", `[...new Intl.Segmenter("en").segment(${textLike("a")})].length`);
add("intl-getCanonicalLocales", `Intl.getCanonicalLocales(${withGetter("length", "1", '0: "en"')})`);
add("intl-locale", `new Intl.Locale(${textLike("en")}).language`);
add("number-toLocaleString-options", `(1).toLocaleString("en", ${withGetter("style", '"decimal"')})`);
add("string-localeCompare-options", `"a".localeCompare("a", "en", ${withGetter("sensitivity", '"base"')})`);
add("string-toLocaleUpperCase-locales", `"a".toLocaleUpperCase(${withGetter("length", "1", '0: "en"')})`);
add(
  "disposablestack-use",
  `(() => { const d = new DisposableStack(); d.use({ [Symbol.dispose]() { change(); } }); d.dispose(); return d.disposed; })()`,
);
add(
  "disposablestack-defer",
  `(() => { const d = new DisposableStack(); d.defer(${callback("", "0")}); d.dispose(); return d.disposed; })()`,
);
add(
  "disposablestack-adopt",
  `(() => { const d = new DisposableStack(); d.adopt(1, ${callback("x", "0")}); d.dispose(); return d.disposed; })()`,
);
add(
  "disposablestack-use-getter",
  `(() => { const d = new DisposableStack(); d.use(${withGetter("[Symbol.dispose]", "() => {}")}); d.dispose(); return d.disposed; })()`,
);
add("using-declaration", `(() => { { using x = { [Symbol.dispose]() { change(); } }; } return 0; })()`);

// The code runs in a later job
addAsynchronous("await-thenable", `await { then(r) { change(); r(1); } }`);
addAsynchronous("await-then-getter", `await ${withGetter("then", "undefined")} && 0`);
addAsynchronous("promise-resolve-thenable", `await Promise.resolve({ then(r) { change(); r(1); } })`);
addAsynchronous("promise-resolve-then-getter", `(Promise.resolve(${withGetter("then", "undefined")}), 0)`);
addAsynchronous(
  "promise-resolve-constructor-getter",
  `(() => { const p = Promise.resolve(1); Object.defineProperty(p, "constructor", { get() { change(); return Promise; } }); return Promise.resolve(p) === p; })()`,
);
addAsynchronous(
  "await-constructor-getter",
  `await (() => { const p = Promise.resolve(1); Object.defineProperty(p, "constructor", { get() { change(); return Promise; } }); return p; })()`,
);
addAsynchronous(
  "promise-then-species",
  `await (() => { const p = Promise.resolve(1); p.constructor = { [Symbol.species]: function (e) { change(); return new Promise(e); } }; return p.then(x => x); })()`,
);
addAsynchronous(
  "promise-then-constructor-getter",
  `await (() => { const p = Promise.resolve(1); Object.defineProperty(p, "constructor", { get() { change(); return Promise; } }); return p.then(x => x); })()`,
);
addAsynchronous(
  "promise-catch-then",
  `(() => { const p = Promise.resolve(1); p.then = function () { change(); return 5; }; return p.catch(() => {}); })()`,
);
addAsynchronous(
  "promise-finally-then",
  `(() => { const p = Promise.resolve(1); p.then = function () { change(); return 5; }; return p.finally(() => {}); })()`,
);
addAsynchronous("promise-executor", `await new Promise(r => { change(); r(1); })`);
addAsynchronous("promise-then-callback", `await Promise.resolve(1).then(${callback("x", "x")})`);
addAsynchronous("promise-finally-callback", `await Promise.resolve(1).finally(${callback("", "0")})`);
addAsynchronous("promise-catch-callback", `await Promise.reject(1).catch(${callback("x", "x")})`);
for (const f of ["all", "allSettled", "any", "race"]) {
  addAsynchronous(`promise-${f}-iterable`, `(await Promise.${f}(${iterableWithNext("[1]")})) && 0`);
  addAsynchronous(`promise-${f}-thenable`, `(await Promise.${f}([{ then(r) { change(); r(1); } }])) && 0`);
  addAsynchronous(
    `promise-${f}-resolve`,
    `(await (class P extends Promise { static resolve(x) { change(); return super.resolve(x); } }).${f}([1])) && 0`,
  );
  addAsynchronous(
    `promise-${f}-then`,
    `(await Promise.${f}([(() => { const p = Promise.resolve(1); p.then = function (a, b) { change(); return Promise.prototype.then.call(this, a, b); }; return p; })()])) && 0`,
  );
}
addAsynchronous("promise-try", `await Promise.try(${callback("", "1")})`);
addAsynchronous(
  "promise-withResolvers-subclass",
  `(class P extends Promise { constructor(e) { change(); super(e); } }).withResolvers() && 0`,
);
addAsynchronous(
  "promise-resolve-subclass",
  `await (class P extends Promise { constructor(e) { change(); super(e); } }).resolve(1)`,
);
addAsynchronous("async-return-thenable", `await (async () => ({ then(r) { change(); r(1); } }))()`);
addAsynchronous("async-generator", `(await (async function* () { change(); yield 1; })().next()).value`);
addAsynchronous(
  "for-await-sync-iterable",
  `await (async () => { let n = 0; for await (const x of ${iterableWithNext("[1]")}) n++; return n; })()`,
);
addAsynchronous(
  "for-await-async-iterable",
  `await (async () => { let n = 0; for await (const x of { [Symbol.asyncIterator]() { change(); return { next() { return Promise.resolve({ done: true }); } }; } }) n++; return n; })()`,
);
addAsynchronous("array-fromAsync", `(await Array.fromAsync(${iterableWithNext("[1]")})).length`);
addAsynchronous("array-fromAsync-map", `(await Array.fromAsync([1], ${callback("x", "x")})).length`);
addAsynchronous("queueMicrotask", `await new Promise(r => queueMicrotask(() => { change(); r(1); }))`);
addAsynchronous("setTimeout", `await new Promise(r => setTimeout(() => { change(); r(1); }, 0))`);
addAsynchronous("setTimeout-delay", `await new Promise(r => setTimeout(r, ${numberLike(0)}))`);
addAsynchronous("setImmediate", `await new Promise(r => setImmediate(() => { change(); r(1); }))`);
addAsynchronous("nextTick", `await new Promise(r => process.nextTick(() => { change(); r(1); }))`);
addAsynchronous("bun-sleep", `await Bun.sleep(${numberLike(0)})`);
addAsynchronous("readablestream-start", `(new ReadableStream({ start(c) { change(); c.close(); } }), 0)`);
addAsynchronous(
  "readablestream-pull",
  `(await new ReadableStream({ pull(c) { change(); c.enqueue(1); c.close(); } }).getReader().read()).value`,
);
addAsynchronous("readablestream-start-getter", `(new ReadableStream(${withGetter("start", "undefined")}), 0)`);
addAsynchronous(
  "readablestream-strategy-size",
  `(new ReadableStream({ start(c) { c.enqueue(1); } }, { size() { change(); return 1; } }), 0)`,
);
addAsynchronous(
  "readablestream-strategy-highWaterMark",
  `(new ReadableStream({}, { highWaterMark: ${numberLike(1)} }), 0)`,
);
addAsynchronous("readablestream-cancel", `await new ReadableStream({ cancel() { change(); } }).cancel()`);
addAsynchronous(
  "writablestream-write",
  `await (async () => { const w = new WritableStream({ write() { change(); } }).getWriter(); await w.write(1); return 0; })()`,
);
addAsynchronous(
  "transformstream-transform",
  `await (async () => { const t = new TransformStream({ transform(x, c) { change(); c.enqueue(x); } }); const w = t.writable.getWriter(); w.write(1); return (await t.readable.getReader().read()).value; })()`,
);
addAsynchronous(
  "response-text-stream",
  `await new Response(new ReadableStream({ pull(c) { change(); c.enqueue(new Uint8Array([65])); c.close(); } })).text()`,
);
addAsynchronous(
  "response-async-iterable",
  `await new Response({ async *[Symbol.asyncIterator]() { change(); yield "a"; } }).text()`,
);
addAsynchronous("blob-text", `await new Blob([${textLike("a")}]).text()`);
addAsynchronous(
  "bun-readableStreamToText",
  `await Bun.readableStreamToText(new ReadableStream({ pull(c) { change(); c.enqueue(new Uint8Array([65])); c.close(); } }))`,
);
addAsynchronous(
  "asyncdisposablestack",
  `await (async () => { const d = new AsyncDisposableStack(); d.use({ [Symbol.asyncDispose]() { change(); } }); await d.disposeAsync(); return d.disposed; })()`,
);
addAsynchronous(
  "messagechannel",
  `await new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = e => { change(); c.port1.close(); r(e.data); }; c.port2.postMessage(1); })`,
);
addAsynchronous(
  "messagechannel-getter",
  `await new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = e => { c.port1.close(); r(e.data.k); }; c.port2.postMessage(${withGetter("k", "1")}); })`,
);

// WebAssembly, SubtleCrypto, URLPattern, process, more of Bun, signals, events
const wasm = `new Uint8Array([0,97,115,109,1,0,0,0,1,11,2,96,1,127,1,127,96,0,0,2,9,1,1,109,1,102,0,0,3,3,2,0,1,5,3,1,0,1,7,17,3,1,103,0,1,1,104,0,2,3,109,101,109,2,0,10,13,2,6,0,32,0,16,0,11,4,0,1,11,11])`;
// (module (import "m" "f" (func (param i32) (result i32))) (func (export "g") (param i32) (result i32) local.get 0 call 0) (func (export "h") nop) (memory (export "mem") 1))
add(
  "wasm-import-called",
  `new WebAssembly.Instance(new WebAssembly.Module(${wasm}), { m: { f: ${callback("x", "x + 1")} } }).exports.g(1)`,
);
add(
  "wasm-import-result-converted",
  `new WebAssembly.Instance(new WebAssembly.Module(${wasm}), { m: { f: x => (${numberLike(5)}) } }).exports.g(1)`,
);
add(
  "wasm-export-argument-converted",
  `new WebAssembly.Instance(new WebAssembly.Module(${wasm}), { m: { f: x => x } }).exports.g(${numberLike(5)})`,
);
add(
  "wasm-import-object-getter",
  `new WebAssembly.Instance(new WebAssembly.Module(${wasm}), ${withGetter("m", "({ f: x => x })")}).exports.g(1)`,
);
add(
  "wasm-import-member-getter",
  `new WebAssembly.Instance(new WebAssembly.Module(${wasm}), { m: ${withGetter("f", "x => x")} }).exports.g(1)`,
);
add("wasm-memory-descriptor", `new WebAssembly.Memory(${withGetter("initial", "1")}).buffer.byteLength`);
add("wasm-memory-descriptor-value", `new WebAssembly.Memory({ initial: ${numberLike(1)} }).buffer.byteLength`);
add("wasm-memory-grow", `new WebAssembly.Memory({ initial: 1, maximum: 3 }).grow(${numberLike(1)})`);
add(
  "wasm-table-descriptor",
  `new WebAssembly.Table({ element: ${textLike("anyfunc")}, initial: ${numberLike(1)} }).length`,
);
add("wasm-table-get", `new WebAssembly.Table({ element: "anyfunc", initial: 1 }).get(${numberLike(0)})`);
add("wasm-global-value", `new WebAssembly.Global({ value: "i32", mutable: true }, ${numberLike(5)}).value`);
add(
  "wasm-global-store",
  `(() => { const g = new WebAssembly.Global({ value: "i32", mutable: true }, 0); g.value = ${numberLike(5)}; return g.value; })()`,
);
addAsynchronous(
  "wasm-instantiate",
  `(await WebAssembly.instantiate(${wasm}, { m: { f: ${callback("x", "x + 1")} } })).instance.exports.g(1)`,
);
addAsynchronous(
  "wasm-instantiate-getter",
  `(await WebAssembly.instantiate(${wasm}, ${withGetter("m", "({ f: x => x })")})).instance.exports.g(1)`,
);

addAsynchronous(
  "subtle-digest-algorithm",
  `(await crypto.subtle.digest(${withGetter("name", '"SHA-1"')}, new Uint8Array(1))).byteLength`,
);
addAsynchronous(
  "subtle-digest-name",
  `(await crypto.subtle.digest({ name: ${textLike("SHA-1")} }, new Uint8Array(1))).byteLength`,
);
addAsynchronous(
  "subtle-digest-text",
  `(await crypto.subtle.digest(${textLike("SHA-1")}, new Uint8Array(1))).byteLength`,
);
addAsynchronous("subtle-digest-of-ta", `(await crypto.subtle.digest(${withGetter("name", '"SHA-1"')}, ta)).byteLength`);
addAsynchronous(
  "subtle-import-key-usages",
  `(await crypto.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", false, ${iterableWithNext('["encrypt"]')})).type`,
);
addAsynchronous(
  "subtle-import-key-jwk",
  `(await crypto.subtle.importKey("jwk", ${withGetter("kty", '"oct"', 'k: "AAAAAAAAAAAAAAAAAAAAAA", alg: "A128GCM"')}, "AES-GCM", false, ["encrypt"])).type`,
);
addAsynchronous(
  "subtle-generate-key",
  `(await crypto.subtle.generateKey({ name: "AES-GCM", length: ${numberLike(128)} }, false, ["encrypt"])).type`,
);
add("crypto-get-random-values", `crypto.getRandomValues(new Uint8Array(${numberLike(2)})).length`);
add("crypto-timing-safe-equal", `crypto.timingSafeEqual(new Uint8Array(1), new Uint8Array(${numberLike(1)}))`);
add("url-pattern-init", `new URLPattern(${withGetter("pathname", '"/a"')}).pathname`);
add("url-pattern-text", `new URLPattern(${textLike("http://a/b")}).pathname`);
add("url-pattern-test", `new URLPattern({ pathname: "/a" }).test(${withGetter("pathname", '"/a"')})`);
add("url-pattern-exec", `new URLPattern({ pathname: "/:x" }).exec(${textLike("http://a/b")}).pathname.groups.x`);
add("compression-stream-format", `typeof new CompressionStream(${textLike("gzip")}).readable`);
add("process-ref", `process.ref({ ref() { change(); } })`);
add("process-unref", `process.unref({ unref() { change(); } })`);
add("process-ref-symbol", `process.ref({ [Symbol.for("nodejs.ref")]() { change(); } })`);
add(
  "process-cpu-usage",
  `(() => { try { return typeof process.cpuUsage(${withGetter("user", "0", "system: 0")}); } catch (e) { return e.constructor.name; } })()`,
);
add(
  "process-env-store",
  `(() => { process.env.SET_BY_THE_PROGRAM = ${textLike("x")}; return process.env.SET_BY_THE_PROGRAM; })()`,
);
add("process-env-key", `process.env[${textLike("NOT_SET_ANYWHERE")}]`);
add("process-get-builtin-module", `typeof process.getBuiltinModule(${textLike("node:path")})`);
add("process-stdout-write", `process.stdout.write(${textLike("")}.toString())`);
add("process-set-source-maps", `process.setSourceMapsEnabled(${numberLike(0)})`);
add("bun-file-options", `Bun.file("/nowhere", ${withGetter("type", '"t/t"')}).type`);
add("bun-file-slice", `Bun.file("/nowhere").slice(${numberLike(0)}, ${numberLike(1)}).size >= 0`);
add(
  "bun-resolve-sync",
  `(() => { try { return typeof Bun.resolveSync(${textLike("node:path")}, ${textLike("/")}); } catch (e) { return e.constructor.name; } })()`,
);
add(
  "bun-password-hash-options",
  `typeof Bun.password.hashSync("p", ${withGetter("algorithm", '"bcrypt"', "cost: 4")})`,
);
add(
  "bun-password-hash-text",
  `(() => { try { return typeof Bun.password.hashSync(${textLike("p")}, { algorithm: "bcrypt", cost: 4 }); } catch (e) { return e.constructor.name; } })()`,
);
add("bun-csrf", `typeof Bun.CSRF.generate(${textLike("secret")}, ${withGetter("expiresIn", "1000")})`);
add("bun-sleep-sync", `Bun.sleepSync(${numberLike(0)})`);
add("bun-gc", `typeof Bun.gc(${numberLike(0)})`);
add("bun-transpiler-options", `new Bun.Transpiler(${withGetter("loader", '"ts"')}).transformSync("1").length > 0`);
add("bun-transpiler-define", `new Bun.Transpiler({ define: ${withGetter("K", '"1"')} }).transformSync("K").length > 0`);
add("bun-transpiler-source", `new Bun.Transpiler().transformSync(${textLike("1")}).length > 0`);
add("bun-transpiler-scan", `new Bun.Transpiler().scan(${textLike("import 'a'")}).imports.length`);
add("bun-unsafe-array-buffer-to-string", `Bun.unsafe.arrayBufferToString(new Uint8Array(${numberLike(1)})).length`);
add("bun-jsonc", `Bun.JSONC.parse(${textLike("{} // c")}) && 0`);
add("bun-json5", `typeof Bun.JSON5 === "object" ? Bun.JSON5.parse(${textLike("{a:1}")}).a : (change(), 1)`);
add(
  "bun-markdown",
  `typeof Bun.markdown === "object" ? typeof Bun.markdown.html(${textLike("# a")}) : (change(), "string")`,
);
add("bun-string-width-options", `Bun.stringWidth("a", ${withGetter("countAnsiEscapeCodes", "true")})`);
add("bun-zstd", `Bun.zstdCompressSync(new Uint8Array(1), ${withGetter("level", "1")}).length > 0`);
add("bun-deflate", `Bun.deflateSync(new Uint8Array(1), ${withGetter("level", "1")}).length > 0`);
add("bun-inflate", `Bun.inflateSync(Bun.deflateSync(new Uint8Array(1)), ${withGetter("windowBits", "-15")}).length`);
add(
  "bun-array-buffer-sink",
  `(() => { const s = new Bun.ArrayBufferSink(); s.start(${withGetter("highWaterMark", "16")}); s.write(${textLike("a")}.toString()); return s.end().byteLength; })()`,
);
add("bun-alloc-unsafe", `Bun.allocUnsafe(${numberLike(2)}).length`);
add("bun-hash-seed", `typeof Bun.hash("a", ${numberLike(1)})`);
add("bun-hash-crc32", `Bun.hash.crc32(${textLike("a")})`);
add("bun-env-store", `(() => { Bun.env.SET_THROUGH_BUN = ${textLike("x")}; return Bun.env.SET_THROUGH_BUN; })()`);
add("performance-measure", `performance.measure(${textLike("m")}).name`);
add("performance-measure-options", `performance.measure("m", ${withGetter("start", "0", "end: 1")}).duration`);
add("performance-clear-marks", `performance.clearMarks(${textLike("m")})`);
add("performance-get-entries-by-name", `performance.getEntriesByName(${textLike("zz")}).length`);
add("request-clone", `new Request("http://a/", { method: "POST", body: ${textLike("b")} }).clone().method`);
add("request-signal", `new Request("http://a/", ${withGetter("signal", "undefined")}).signal.aborted`);
add("request-from-request", `new Request(new Request("http://a/"), ${withGetter("method", '"PUT"')}).method`);
add(
  "abort-controller-reason",
  `(() => { const a = new AbortController(); a.signal.addEventListener("abort", ${callback("e", "0")}); a.abort(o); return a.signal.reason === o; })()`,
);
add("abort-signal-abort", `AbortSignal.abort(o).reason === o`);
add(
  "abort-signal-throw-if-aborted",
  `(() => { try { AbortSignal.abort(o).throwIfAborted(); } catch (e) { change(); return e === o; } })()`,
);
add(
  "abort-signal-any-follows",
  `(() => { const a = new AbortController(); const s = AbortSignal.any([a.signal]); s.onabort = ${callback("e", "0")}; a.abort(o); return s.reason === o; })()`,
);
add("abort-signal-timeout", `AbortSignal.timeout(${numberLike(100000)}).aborted`);
add(
  "global-add-event-listener",
  `(() => { const f = ${callback("e", "0")}; addEventListener("first", f); dispatchEvent(new Event("first")); removeEventListener("first", f); })()`,
);
add(
  "global-listener-options",
  `(() => { const f = () => {}; addEventListener("first", f, ${withGetter("once", "true")}); dispatchEvent(new Event("first")); })()`,
);
add(
  "event-listener-removes-itself",
  `(() => { const t = new EventTarget(); const f = () => { change(); t.removeEventListener("e", g); }; const g = () => { change(); }; t.addEventListener("e", f); t.addEventListener("e", g); return t.dispatchEvent(new Event("e")); })()`,
);
add(
  "event-stop-immediate",
  `(() => { const t = new EventTarget(); t.addEventListener("e", e => { change(); e.stopImmediatePropagation(); }); t.addEventListener("e", () => { change(); }); return t.dispatchEvent(new Event("e")); })()`,
);
add(
  "event-listener-signal",
  `(() => { const t = new EventTarget(); const a = new AbortController(); t.addEventListener("e", ${callback("e", "0")}, { signal: a.signal }); t.dispatchEvent(new Event("e")); a.abort(); return t.dispatchEvent(new Event("e")); })()`,
);
add("error-event-init", `new ErrorEvent("error", ${withGetter("error", "o")}).error === o`);
add("message-event-init", `new MessageEvent("message", ${withGetter("data", "o")}).data === o`);
add("close-event-init", `new CloseEvent("close", ${withGetter("code", "1000")}).code`);
add("console-dir-options", `console.dir({}, ${withGetter("depth", "1")})`);
add("console-time-label", `(console.time(${textLike("l")}), 0)`);
add("console-count-reset", `console.countReset(${textLike("zz")})`);
add(
  "console-log-nested-custom",
  `console.log({ a: [{ [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) { change(); return typeof depth + typeof options + typeof inspect; } }] })`,
);
add(
  "console-log-map-of-custom",
  `console.log(new Map([[{ [Symbol.for("nodejs.util.inspect.custom")]() { change(); return "k"; } }, 1]]))`,
);
add(
  "console-log-error-with-getter",
  `console.log(Object.defineProperty(new Error("m"), "extra", { get() { change(); return 1; }, enumerable: true }).message)`,
);
add(
  "console-error-cause-getter",
  `console.log(typeof Bun.inspect(Object.defineProperty(new Error("m"), "cause", { get() { change(); return 1; }, enumerable: false })))`,
);
add("console-log-o", `console.log(o, arr, c, m, st, ${withGetter("k", "1")})`);
add(
  "text-decoder-stream",
  `typeof new TextDecoderStream(${textLike("utf-8")}, ${withGetter("fatal", "false")}).readable`,
);
add("blob-array-buffer-part", `new Blob([ta, ${textLike("a")}, ta]).size`);
add(
  "form-data-set-blob-name",
  `(() => { const f = new FormData(); f.set("a", new Blob(["x"]), ${textLike("n")}); return f.withGetter("a").name; })()`,
);
add("headers-get-name", `new Headers({ a: "1" }).get(${textLike("a")})`);
add("headers-from-headers", `new Headers(new Headers(${withGetter("k", '"1"')})).withGetter("k")`);
add("response-clone", `new Response(${textLike("b")}).clone().status`);
add(
  "response-headers-iterable",
  `new Response("", { headers: ${iterableWithNext('[["k", "1"]]')} }).headers.withGetter("k")`,
);
add(
  "url-search-params-of-url",
  `(() => { const u = new URL("http://a/?x=1"); u.searchParams.set(${textLike("x")}, ${textLike("2")}); return u.href; })()`,
);
add("url-parse", `URL.parse(${textLike("http://a/")}, ${textLike("http://b/")}).href`);
add("url-create-object-url", `typeof URL.createObjectURL(new Blob([${textLike("a")}]))`);
add("dom-exception-name", `new DOMException("m", ${textLike("AbortError")}).code`);
add("structured-clone-map-with-getter", `structuredClone(new Map([[1, ${withGetter("k", "1")}]])).get(1).k`);
add("structured-clone-array-with-getter", `structuredClone([${withGetter("k", "1")}, arr]).length`);
add(
  "structured-clone-error-with-getter",
  `structuredClone(Object.defineProperty(new Error("m"), "message", { get() { change(); return "g"; } })).message`,
);
add("set-timeout-unref", `(() => { const t = setTimeout(() => {}, ${numberLike(1)}); clearTimeout(t); })()`);
add("clear-timeout-primitive", `clearTimeout(${primitiveLike("0")})`);
add("clear-timeout-object", `clearTimeout(${numberLike(0)})`);
add("atomics-notify", `Atomics.notify(new Int32Array(new SharedArrayBuffer(8)), ${numberLike(0)}, ${numberLike(1)})`);
add(
  "atomics-wait-timeout",
  `Atomics.wait(new Int32Array(new SharedArrayBuffer(8)), ${numberLike(0)}, 1, ${numberLike(0)})`,
);
add(
  "atomics-wait-async",
  `typeof Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(8)), ${numberLike(0)}, 1, 0).value`,
);
add("atomics-is-lock-free", `Atomics.isLockFree(${numberLike(4)})`);
add(
  "shared-array-buffer-grow",
  `(() => { const s = new SharedArrayBuffer(8, { maxByteLength: 16 }); s.grow(${numberLike(16)}); return s.byteLength; })()`,
);
add("shared-array-buffer-slice", `new SharedArrayBuffer(8).slice(${numberLike(0)}).byteLength`);
add("weak-ref-construct", `new WeakRef(o).deref() === o`);
add("finalization-register", `new FinalizationRegistry(${callback("h", "0")}).register({}, o, o)`);
add("finalization-unregister", `new FinalizationRegistry(() => {}).unregister(o)`);
add("eval-direct", `eval("change(); 1")`);
add("eval-indirect", `(globalThis.changeFromText = change, (0, eval)("changeFromText(); 1"))`);
add("function-constructor", `(globalThis.changeFromText = change, new Function("changeFromText(); return 1")())`);
add("function-constructor-parts", `new Function(${textLike("a")}, ${textLike("return a")})(1)`);

// The code lies on what the program has answered to the built-in, or is a function that was put into a built-in and taken out again
add("sort-comparator-answer", `[2, 1].sort((a, b) => (${numberLike(1)}))`);
add("sort-of-arr-comparator-answer", `arr.sort((a, b) => (${numberLike(1)})).length`);
add("to-sorted-comparator-answer", `[2, 1].toSorted((a, b) => (${numberLike(1)}))`);
add("typed-sort-comparator-answer", `new Uint8Array([2, 1]).sort((a, b) => (${numberLike(1)}))[0]`);
add(
  "typed-sort-of-ta-comparator-answer",
  `(() => { try { return ta.sort((a, b) => (${numberLike(1)})).length; } catch (e) { return e.constructor.name; } })()`,
);
add("typed-map-answer", `new Uint8Array(1).map(x => (${numberLike(1)}))[0]`);
add(
  "typed-map-of-ta-answer",
  `(() => { try { return ta.map(x => (${numberLike(1)})).length; } catch (e) { return e.constructor.name; } })()`,
);
add("typed-from-answer", `Uint8Array.from([1], x => (${numberLike(1)}))[0]`);
add("flat-map-answer-proxy", `[1].flatMap(x => new Proxy([x], { get(t, k) { change(); return t[k]; } }))`);
add(
  "flat-map-answer-array-with-getter",
  `[1].flatMap(x => Object.defineProperty([0], 0, { get() { change(); return 5; } }))`,
);
add("flat-of-array-with-getter", `[Object.defineProperty([0], 0, { get() { change(); return 5; } })].flat()`);
add("replace-answer", `"a".replace("a", () => (${textLike("b")}))`);
add("replace-regexp-answer", `"a".replace(/a/, () => (${textLike("b")}))`);
add("replace-global-answer", `"aa".replace(/a/g, () => (${textLike("b")}))`);
add("replace-all-answer", `"aa".replaceAll("a", () => (${textLike("b")}))`);
add("group-by-answer", `Object.keys(Object.groupBy([1], x => (${textLike("k")})))`);
add("replacer-answer-getter", `JSON.stringify({ k: 1 }, (k, x) => (k === "" ? ${withGetter("q", "1")} : x))`);
add(
  "replacer-answer-nested-to-json",
  `JSON.stringify({ k: 1 }, (k, x) => (k === "" ? { n: { toJSON() { change(); return 1; } } } : x))`,
);
add("to-json-answer-getter", `JSON.stringify({ toJSON() { return ${withGetter("q", "1")}; } })`);
add(
  "to-json-answer-nested-to-json",
  `JSON.stringify({ toJSON() { return { n: { toJSON() { change(); return 2; } } }; } })`,
);
add(
  "to-json-answer-wrapper",
  `JSON.stringify({ toJSON() { const n = new Number(1); n.valueOf = () => { change(); return 2; }; return n; } })`,
);
add(
  "reviver-answer-kept",
  `JSON.parse('{"a":{"b":1}}', function (k, x) { if (k === "b") { change(); return o; } return x; }).a.b === o`,
);
add("own-keys-answer-length", `Reflect.ownKeys(new Proxy({}, { ownKeys() { return ${withGetter("length", "0")}; } }))`);
add(
  "own-keys-answer-element",
  `Reflect.ownKeys(new Proxy({}, { ownKeys() { return { length: 1, get 0() { change(); return "k"; } }; } }))`,
);
add(
  "object-keys-answer-element",
  `Object.keys(new Proxy({}, { ownKeys() { return { length: 1, get 0() { change(); return "k"; } }; } }))`,
);
add(
  "descriptor-answer-getter",
  `Object.getOwnPropertyDescriptor(new Proxy({}, { getOwnPropertyDescriptor() { return ${withGetter("value", "1", "configurable: true")}; } }), "k").value`,
);
add(
  "has-own-answer-getter",
  `Object.hasOwn(new Proxy({}, { getOwnPropertyDescriptor() { return ${withGetter("value", "1", "configurable: true")}; } }), "k")`,
);
add(
  "spread-descriptor-answer-getter",
  `({ ...new Proxy({ k: 1 }, { getOwnPropertyDescriptor() { return ${withGetter("enumerable", "true", "configurable: true, value: 1")}; } }) }).k`,
);
add(
  "iterator-answer-next-getter",
  `[...{ [Symbol.iterator]() { return ${withGetter("next", "() => ({ done: true })")}; } }].length`,
);
add(
  "iterator-answer-inherits-next",
  `[...{ [Symbol.iterator]() { return Object.create({ next() { change(); return { done: true }; } }); } }].length`,
);
add(
  "iterator-answer-class",
  `[...{ [Symbol.iterator]() { return new (class { next() { change(); return { done: true }; } })(); } }].length`,
);
add(
  "next-answer-inherits-done",
  `[...{ [Symbol.iterator]() { return { next() { return Object.create({ get done() { change(); return true; } }); } }; } }].length`,
);
add(
  "next-answer-proxy",
  `[...{ [Symbol.iterator]() { return { next() { return new Proxy({ done: true }, { get(t, k) { change(); return t[k]; } }); } }; } }].length`,
);
add(
  "array-from-next-answer-value",
  `(() => { let n = 0; return Array.from({ [Symbol.iterator]() { return { next() { return n++ ? { done: true } : { done: false, get value() { change(); return 1; } }; } }; } }).length; })()`,
);
add(
  "map-construct-next-answer-entry",
  `(() => { let n = 0; return new Map({ [Symbol.iterator]() { return { next() { return n++ ? { done: true } : { done: false, value: ${withGetter("0", '"k"', "1: 1")} }; } }; } }).size; })()`,
);
add(
  "exec-answer-index",
  `(() => { const r = /a/; r.exec = () => ({ get index() { change(); return 0; }, length: 1, 0: "a" }); return "a".replace(r, "b"); })()`,
);
add(
  "exec-answer-length",
  `(() => { const r = /a/; r.exec = () => ({ index: 0, get length() { change(); return 1; }, 0: "a" }); return "a".replace(r, "b"); })()`,
);
add(
  "exec-answer-match",
  `(() => { const r = /a/; r.exec = () => ({ index: 0, length: 1, 0: ${textLike("a")} }); return "a".replace(r, "b"); })()`,
);
add(
  "exec-answer-groups",
  `(() => { const r = /a/; r.exec = () => ({ index: 0, length: 1, 0: "a", groups: ${withGetter("n", '"g"')} }); return "a".replace(r, "$<n>"); })()`,
);
add(
  "exec-answer-groups-getter",
  `(() => { const r = /a/; r.exec = () => ({ index: 0, length: 1, 0: "a", get groups() { change(); return undefined; } }); return "a".replace(r, "b"); })()`,
);
add(
  "exec-answer-in-match",
  `(() => { const r = /a/g; let n = 0; r.exec = () => (n++ ? null : { 0: ${textLike("a")} }); return "a".match(r); })()`,
);
add(
  "exec-answer-in-split",
  `(() => { class R extends RegExp { exec(s) { const m = super.exec(s); if (m) Object.defineProperty(m, "length", { get() { change(); return 1; } }); return m; } } return "bab".split(new R("a")); })()`,
);
add(
  "exec-answer-in-search",
  `(() => { const r = /a/; r.exec = () => (${withGetter("index", "0")}); return "a".search(r); })()`,
);
add(
  "exec-answer-in-test",
  `(() => { const r = /a/; r.exec = () => (${withGetter("index", "0")}); return r.test("a"); })()`,
);
add(
  "species-answer-setter",
  `(() => { const s = [1, 2]; s.constructor = { [Symbol.species]: function () { return { set length(x) { change(); } }; } }; return typeof s.slice(0); })()`,
);
add(
  "species-answer-proxy",
  `(() => { const s = [1, 2]; s.constructor = { [Symbol.species]: function () { return new Proxy([], { defineProperty(t, k, d) { change(); return Reflect.defineProperty(t, k, d); } }); } }; return s.map(x => x).length; })()`,
);
add(
  "species-answer-is-arr",
  `(() => { const s = [7, 8]; s.constructor = { [Symbol.species]: function () { change(); return arr; } }; return s.map(x => x) === arr; })()`,
);
add(
  "species-answer-is-o",
  `(() => { const s = [7, 8]; s.constructor = { [Symbol.species]: function () { change(); return o; } }; return s.filter(x => true) === o; })()`,
);
add(
  "typed-species-answer-is-ta",
  `(() => { const s = new Uint8Array([7, 8]); s.constructor = { [Symbol.species]: function () { change(); return ta; } }; try { return s.map(x => x) === ta; } catch (e) { return e.constructor.name; } })()`,
);
add("array-from-constructor-answer-is-arr", `Array.from.call(function () { change(); return arr; }, [7, 8]) === arr`);
add("array-of-constructor-answer-is-o", `Array.of.call(function () { change(); return o; }, 7, 8) === o`);
add(
  "to-primitive-answer-object",
  `(() => { try { return \`\${{ [Symbol.toPrimitive]() { change(); return {}; } }}\`; } catch (e) { return e.constructor.name; } })()`,
);
add("value-of-answer-object", `+{ valueOf() { change(); return {}; }, toString() { change(); return "1"; } }`);
add("has-instance-answer", `({}) instanceof { [Symbol.hasInstance]() { return ${numberLike(0)}; } }`);
add(
  "inspect-custom-answer-getter",
  `Bun.inspect({ [Bun.inspect.custom]() { return ${withGetter("k", "1")}; } }).length > 0`,
);
add(
  "inspect-custom-answer-custom",
  `Bun.inspect({ [Bun.inspect.custom]() { return { [Bun.inspect.custom]() { change(); return "in"; } }; } })`,
);
add(
  "console-log-custom-answer-custom",
  `console.log({ [Symbol.for("nodejs.util.inspect.custom")]() { return { [Symbol.for("nodejs.util.inspect.custom")]() { change(); return "in"; } }; } })`,
);
add(
  "stream-size-answer",
  `(new ReadableStream({ start(c) { c.enqueue(1); } }, { size() { return ${numberLike(1)}; } }), 0)`,
);
add(
  "set-like-keys-answer",
  `st.union({ size: 1, has() { return true; }, keys() { return ${withGetter("next", "() => ({ done: true })")}; } }).size`,
);
add(
  "set-like-next-answer",
  `st.union({ size: 1, has() { return true; }, keys() { return { next() { return ${withGetter("done", "true")}; } }; } }).size`,
);
add(
  "set-like-has-answer",
  `st.intersection({ size: 100, has() { return ${numberLike(1)}; }, keys() { return [][Symbol.iterator](); } }).size`,
);
add("iterator-flat-map-answer", `[1].values().flatMap(x => (${iterableWithNext("[1]")})).toArray().length`);
add(
  "iterator-from-answer",
  `Iterator.from({ [Symbol.iterator]() { return { next() { change(); return { done: true }; } }; } }).toArray().length`,
);
add(
  "bound-getter-answer",
  `Object.defineProperty({}, "p", { get: (function () { change(); return this; }).bind(o) }).p === o`,
);
add(
  "prepare-stack-trace-answer",
  `(() => { const old = Error.prepareStackTrace; Error.prepareStackTrace = () => (${textLike("s")}); const s = \`\${new Error("m").stack}\`; Error.prepareStackTrace = old; return s; })()`,
);
add("emitter-listener-answer", `0 + [process.once("second", () => (${numberLike(1)})), process.emit("second")].length`);
add(
  "define-property-from-descriptor-answer",
  `Object.defineProperty({}, "k", Object.getOwnPropertyDescriptor(${withGetter("k", "1")}, "k")).k`,
);
add(
  "define-properties-from-descriptors",
  `Object.defineProperties({}, Object.getOwnPropertyDescriptors(${withGetter("k", "1")})).k`,
);
add("create-from-descriptors", `Object.create(null, Object.getOwnPropertyDescriptors(${withGetter("k", "1")})).k`);
add("lookup-getter-called", `(${withGetter("k", "1")}).__lookupGetter__("k")()`);
add("descriptor-getter-called", `Object.getOwnPropertyDescriptor(${withGetter("k", "1")}, "k").get()`);
add(
  "reflect-descriptor-getter-called",
  `Reflect.getOwnPropertyDescriptor(${withGetter("k", "1")}, "k").get.call(null)`,
);
add(
  "entries-of-descriptors-getter-called",
  `Object.values(Object.getOwnPropertyDescriptors(${withGetter("k", "1")}))[0].get()`,
);
add(
  "class-getter-descriptor-called",
  `Object.getOwnPropertyDescriptor((class { get k() { change(); return 1; } }).prototype, "k").get.call({})`,
);
add("method-taken-from-values", `Object.values({ f() { change(); return 1; } })[0]()`);
add("method-taken-from-entries", `Object.entries({ f() { change(); return 1; } })[0][1]()`);
add("method-taken-from-assign", `Object.assign({}, { f() { change(); return 1; } }).f()`);
add("method-taken-from-spread", `({ ...{ f() { change(); return 1; } } }).f()`);
add("method-taken-from-from-entries", `Object.fromEntries([["f", () => { change(); return 1; }]]).f()`);
add("method-taken-from-map", `new Map([["f", () => { change(); return 1; }]]).withGetter("f")()`);
add("method-taken-from-set", `[...new Set([() => { change(); return 1; }])][0]()`);
add(
  "method-taken-from-weak-map",
  `(() => { const k = {}; return new WeakMap([[k, () => { change(); return 1; }]]).get(k)(); })()`,
);
add("method-taken-from-weak-ref", `new WeakRef(() => { change(); return 1; }).deref()()`);
add("method-taken-from-array-at", `[() => { change(); return 1; }].at(0)()`);
add("method-taken-from-array-find", `[() => { change(); return 1; }].find(f => true)()`);
add("method-taken-from-array-pop", `[() => { change(); return 1; }].pop()()`);
add("method-taken-from-array-slice", `[() => { change(); return 1; }].slice()[0]()`);
add("method-taken-from-array-concat", `[].concat([() => { change(); return 1; }])[0]()`);
add("method-taken-from-array-flat", `[[() => { change(); return 1; }]].flat()[0]()`);
add("method-taken-from-array-from", `Array.from([() => { change(); return 1; }])[0]()`);
add("method-taken-from-array-of", `Array.of(() => { change(); return 1; })[0]()`);
add("method-taken-from-to-reversed", `[() => { change(); return 1; }].toReversed()[0]()`);
add("method-taken-from-with", `[0].with(0, () => { change(); return 1; })[0]()`);
add("method-taken-from-to-spliced", `[].toSpliced(0, 0, () => { change(); return 1; })[0]()`);
add("method-taken-from-splice", `[() => { change(); return 1; }].splice(0, 1)[0]()`);
add("method-taken-from-fill", `new Array(1).fill(() => { change(); return 1; })[0]()`);
add("method-taken-from-values-iterator", `[() => { change(); return 1; }].values().next().value()`);
add("method-taken-from-entries-iterator", `[() => { change(); return 1; }].entries().next().value[1]()`);
add("method-taken-from-iterator-helper", `[() => { change(); return 1; }].values().map(f => f).next().value()`);
add("method-taken-from-to-array", `[() => { change(); return 1; }].values().toArray()[0]()`);
add("method-taken-from-group-by", `Object.groupBy([() => { change(); return 1; }], () => "k").k[0]()`);
add("method-taken-from-map-group-by", `Map.groupBy([() => { change(); return 1; }], () => "k").withGetter("k")[0]()`);
add("method-taken-from-reduce", `[() => { change(); return 1; }].reduce((a, f) => f, null)()`);
add("method-taken-from-reflect-get", `Reflect.get({ f() { change(); return 1; } }, "f")()`);
add(
  "method-taken-from-descriptor-value",
  `Object.getOwnPropertyDescriptor({ f() { change(); return 1; } }, "f").value()`,
);
add("method-taken-from-create", `Object.create({ f() { change(); return 1; } }).f()`);
add("method-taken-from-prototype-of", `Object.getPrototypeOf(Object.create({ f() { change(); return 1; } })).f()`);
add("method-taken-from-error-cause", `new Error("m", { cause: () => { change(); return 1; } }).cause()`);
add("method-taken-from-aggregate", `new AggregateError([() => { change(); return 1; }]).errors[0]()`);
add("method-taken-from-suppressed", `new SuppressedError(() => { change(); return 1; }, 0).error()`);
add("method-taken-from-custom-event", `new CustomEvent("e", { detail: () => { change(); return 1; } }).detail()`);
add("method-taken-from-abort-reason", `AbortSignal.abort(() => { change(); return 1; }).reason()`);
add("method-taken-from-bound-arguments", `((f) => f()).bind(null, () => { change(); return 1; })()`);
add("method-taken-from-bound-this", `(function () { return this(); }).bind(() => { change(); return 1; })()`);
add("method-taken-from-proxy", `new Proxy({ f() { change(); return 1; } }, {}).f()`);
add("method-taken-from-thrown", `(() => { try { throw () => { change(); return 1; }; } catch (f) { return f(); } })()`);
add("method-taken-from-generator", `(function* () { yield () => { change(); return 1; }; })().next().value()`);
add(
  "method-taken-from-generator-sent",
  `(() => { const g = (function* () { return (yield)(); })(); g.next(); return g.next(() => { change(); return 1; }).value; })()`,
);
add("method-taken-from-generator-return", `(function* () {})().return(() => { change(); return 1; }).value()`);
add(
  "method-taken-from-symbol-key",
  `(() => { const s = Symbol(); return Object.getOwnPropertySymbols({ [s]() { change(); return 1; } }).map(k => ({ [s]() { change(); return 1; } })[k])[0](); })()`,
);
add(
  "method-taken-by-own-names",
  `(() => { const t = { f() { change(); return 1; } }; return t[Object.getOwnPropertyNames(t)[0]](); })()`,
);
add("method-taken-by-keys", `(() => { const t = { f() { change(); return 1; } }; return t[Object.keys(t)[0]](); })()`);
add(
  "method-taken-by-for-in",
  `(() => { const t = { f() { change(); return 1; } }; for (const k in t) return t[k](); })()`,
);
add(
  "method-taken-by-reflect-own-keys",
  `(() => { const t = { f() { change(); return 1; } }; return t[Reflect.ownKeys(t)[0]](); })()`,
);
add(
  "class-method-taken-by-own-names",
  `(() => { class K { f() { change(); return 1; } } return K.prototype[Object.getOwnPropertyNames(K.prototype)[1]](); })()`,
);
add(
  "method-taken-from-disposable-use",
  `new DisposableStack().use({ [Symbol.dispose]() {}, f() { change(); return 1; } }).f()`,
);
add("method-taken-from-get-or-insert", `new Map().getOrInsert(1, () => { change(); return 1; })()`);
add("method-taken-from-set-union", `[...new Set().union(new Set([() => { change(); return 1; }]))][0]()`);
add("method-taken-from-object-call", `Object({ f() { change(); return 1; } }).f()`);
add("method-taken-from-freeze", `Object.freeze({ f() { change(); return 1; } }).f()`);
add("method-taken-from-value-of", `({ f() { change(); return 1; } }).valueOf().f()`);
add("method-taken-from-array-sort", `[() => { change(); return 1; }].sort()[0]()`);
add("method-taken-from-array-reverse", `[() => { change(); return 1; }].reverse()[0]()`);
add("method-taken-from-copy-within", `[0, () => { change(); return 1; }].copyWithin(0, 1)[0]()`);
add("method-taken-from-arguments", `(function () { return arguments[0](); })(() => { change(); return 1; })`);
add(
  "method-taken-from-arguments-slice",
  `(function () { return Array.prototype.slice.call(arguments)[0](); })(() => { change(); return 1; })`,
);
add("method-taken-from-rest", `((...r) => r[0]())(() => { change(); return 1; })`);
add(
  "method-taken-from-apply-arguments",
  `(function () { return (f => f()).apply(null, arguments); })(() => { change(); return 1; })`,
);
addAsynchronous("then-answer-thenable", `await Promise.resolve(1).then(() => ({ then(r) { change(); r(2); } }))`);
addAsynchronous(
  "then-answer-then-getter",
  `(await Promise.resolve(1).then(() => (${withGetter("then", "undefined")}))) && 0`,
);
addAsynchronous("finally-answer-thenable", `await Promise.resolve(1).finally(() => ({ then(r) { change(); r(2); } }))`);
addAsynchronous(
  "finally-answer-rejects",
  `await Promise.resolve(1).finally(() => Promise.reject(o)).catch(e => { change(); return e === o; })`,
);
addAsynchronous(
  "finally-throws",
  `await Promise.resolve(1).finally(() => { throw o; }).catch(e => { change(); return e === o; })`,
);
addAsynchronous(
  "then-throws",
  `await Promise.resolve(1).then(() => { throw o; }).catch(e => { change(); return e === o; })`,
);
addAsynchronous("catch-answer-thenable", `await Promise.reject(1).catch(() => ({ then(r) { change(); r(2); } }))`);
addAsynchronous("executor-resolves-thenable", `await new Promise(r => r({ then(q) { change(); q(2); } }))`);
addAsynchronous(
  "with-resolvers-thenable",
  `await (() => { const w = Promise.withResolvers(); w.resolve({ then(q) { change(); q(2); } }); return w.promise; })()`,
);
addAsynchronous(
  "with-resolvers-function",
  `await (() => { const w = Promise.withResolvers(); w.resolve(() => { change(); return 1; }); return w.promise.then(f => f()); })()`,
);
addAsynchronous("all-function", `(await Promise.all([() => { change(); return 1; }]))[0]()`);
addAsynchronous("all-settled-function", `(await Promise.allSettled([() => { change(); return 1; }]))[0].value()`);
addAsynchronous(
  "all-settled-reason",
  `(await Promise.allSettled([Promise.reject(() => { change(); return 1; })]))[0].reason()`,
);
addAsynchronous("any-function", `(await Promise.any([() => { change(); return 1; }]))()`);
addAsynchronous(
  "any-errors",
  `await Promise.any([Promise.reject(() => { change(); return 1; })]).catch(e => e.errors[0]())`,
);
addAsynchronous("race-function", `(await Promise.race([() => { change(); return 1; }]))()`);
addAsynchronous(
  "async-dispose-answer",
  `await (async () => { const d = new AsyncDisposableStack(); d.use({ [Symbol.asyncDispose]() { return { then(r) { change(); r(); } }; } }); await d.disposeAsync(); })()`,
);
addAsynchronous("from-async-mapper-answer", `(await Array.fromAsync([1], () => ({ then(r) { change(); r(2); } })))[0]`);
addAsynchronous("from-async-element-thenable", `(await Array.fromAsync([{ then(r) { change(); r(2); } }]))[0]`);
addAsynchronous(
  "async-generator-yields-thenable",
  `(await (async function* () { yield { then(r) { change(); r(2); } }; })().next()).value`,
);
addAsynchronous(
  "async-generator-return-thenable",
  `(await (async function* () {})().return({ then(r) { change(); r(2); } })).value`,
);
addAsynchronous(
  "for-await-next-answer-thenable",
  `await (async () => { for await (const x of { [Symbol.asyncIterator]() { return { next() { return { then(r) { change(); r({ done: true }); } }; } }; } }); })()`,
);
addAsynchronous(
  "for-await-sync-value-thenable",
  `await (async () => { let s = 0; for await (const x of [{ then(r) { change(); r(2); } }]) s += x; return s; })()`,
);
addAsynchronous(
  "stream-pull-answer-thenable",
  `(await new ReadableStream({ pull(c) { c.enqueue(1); c.close(); return { then(r) { change(); r(); } }; } }).getReader().read()).value`,
);
addAsynchronous(
  "stream-read-function",
  `(await new ReadableStream({ start(c) { c.enqueue(() => { change(); return 1; }); c.close(); } }).getReader().read()).value()`,
);
addAsynchronous(
  "timeout-argument-function",
  `await new Promise(r => setTimeout(f => r(f()), 0, () => { change(); return 1; }))`,
);
addAsynchronous(
  "next-tick-argument-function",
  `await new Promise(r => process.nextTick(f => r(f()), () => { change(); return 1; }))`,
);
addAsynchronous(
  "immediate-argument-function",
  `await new Promise(r => setImmediate(f => r(f()), () => { change(); return 1; }))`,
);
addAsynchronous("peek-function", `Bun.peek(Promise.resolve(() => { change(); return 1; }))()`);
addAsynchronous(
  "serve-answer-thenable",
  `await (async () => { const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { return { then(r) { change(); r(new Response("ok")); } }; } }); try { return await (await fetch("http://127.0.0.1:" + s.port + "/")).text(); } finally { s.stop(true); } })()`,
);

// A built-in is handed another built-in where it takes a function or looks up a member, and that one changes what the caller reads.
/** A function, and what it is to be handed first. */
const changingBuiltIns: Record<string, [callee: string, operand: string]> = {
  "freeze": ["Object.freeze", "o"],
  "seal": ["Object.seal", "o"],
  "prevent-extensions": ["Object.preventExtensions", "o"],
  "delete-of-o": ["Reflect.deleteProperty.bind(null, o)", '"a"'],
  "prototype-of-o": ["Object.setPrototypeOf.bind(null, o)", "{ inherited: 7 }"],
  "assign-to-o": ["Object.assign.bind(null, o)", '{ a: "changed", z: 9 }'],
  "define-on-o": ['Object.defineProperty.bind(null, o, "a")', '{ get() { return "got"; }, configurable: true }'],
  "define-properties-on-o": ["Object.defineProperties.bind(null, o)", '{ a: { value: "changed" }, z: { value: 9 } }'],
  "push": ["arr.push.bind(arr)", '"s"'],
  "push-unbound-call": ["Function.prototype.call.bind(Array.prototype.push, arr)", '"s"'],
  "pop": ["arr.pop.bind(arr)", "0"],
  "shift": ["arr.shift.bind(arr)", "0"],
  "reverse": ["arr.reverse.bind(arr)", "0"],
  "splice": ["arr.splice.bind(arr)", "0"],
  "unshift": ["arr.unshift.bind(arr)", "{ k: 1 }"],
  "fill": ["arr.fill.bind(arr)", '"s"'],
  "length-of-arr": ['Reflect.set.bind(null, arr, "length")', "0"],
  "map-clear": ["m.clear.bind(m)", "0"],
  "map-set": ["m.set.bind(m)", '"k"'],
  "map-delete": ["m.delete.bind(m)", '"k"'],
  "set-delete": ["st.delete.bind(st)", "1"],
  "set-add": ["st.add.bind(st)", "{ k: 1 }"],
  "resize": ["buf.resize.bind(buf)", "0"],
  "transfer": ["buf2.transfer.bind(buf2)", "0"],
  "typed-fill": ["ta.fill.bind(ta)", "9"],
  "typed-set": ["ta.set.bind(ta)", "[7, 7]"],
  "dataview-set": ["dv.setUint8.bind(dv, 0)", "77"],
  "capture-stack": ["Error.captureStackTrace", "o"],
  "instance-push": ["Array.prototype.push.bind(c)", '"s"'],
  "instance-assign": ["Object.assign.bind(null, c)", '{ x: "changed" }'],
};

/** F stands for the function and X for what it is handed. */
const takers: Record<string, string> = {
  "for-each": "[X].forEach(F)",
  "map": "[X].map(F)",
  "filter": "[X].filter(F)",
  "some": "[X].some(F)",
  "every": "[X].every(F)",
  "find": "[X].find(F)",
  "find-last-index": "[X].findLastIndex(F)",
  "flat-map": "[X].flatMap(F)",
  "reduce": "[0, X].reduce((a, x) => F(x))",
  "reduce-direct": "[X, 0].reduce(F)",
  "array-from": "Array.from([X], F)",
  "array-from-like": "Array.from({ length: 1, 0: X }, F)",
  "sort": "[X, X].sort(F)",
  "to-sorted": "[X, X].toSorted(F)",
  "map-for-each": "new Map([[0, X]]).forEach(F)",
  "set-for-each": "new Set([X]).forEach(F)",
  "group-by": "Object.groupBy([X], F)",
  "map-group-by": "Map.groupBy([X], F)",
  "iterator-map": "[X].values().map(F).toArray()",
  "iterator-for-each": "[X].values().forEach(F)",
  "iterator-filter": "[X].values().filter(F).toArray()",
  "iterator-some": "[X].values().some(F)",
  "iterator-flat-map":
    "(() => { try { return [X].values().flatMap(F).toArray(); } catch (e) { return e.constructor.name; } })()",
  "call": "F.call(null, X)",
  "apply": "F.apply(null, [X])",
  "apply-like": "F.apply(null, { length: 1, 0: X })",
  "reflect-apply": "Reflect.apply(F, null, [X])",
  "bind": "F.bind(null, X)()",
  "bind-twice": "F.bind(null).bind(null, X)()",
  "call-call": "Function.prototype.call.call(F, null, X)",
  "call-bind": "Function.prototype.call.bind(F)(null, X)",
  "apply-bind": "Function.prototype.apply.bind(F)(null, [X])",
  "spread": "F(...[X])",
  "optional": "F?.(X)",
  "comma": "(0, F)(X)",
  "through-object": "({ f: F }).f(X)",
  "through-array": "[F][0](X)",
  "through-map": "new Map([[1, F]]).get(1)(X)",
  "through-conditional": "(hits > 100 ? Object.keys : F)(X)",
  "getter": '(() => { const x = X; return Object.defineProperty({}, "p", { get: F.bind(null, x) }).p; })()',
  "setter": '(() => { Object.defineProperty({}, "p", { set: F }).p = X; })()',
  "value-of":
    "(() => { const x = X; try { return +{ valueOf: F.bind(null, x) }; } catch (e) { return e.constructor.name; } })()",
  "to-string":
    "(() => { const x = X; try { return `${{ toString: F.bind(null, x) }}`; } catch (e) { return e.constructor.name; } })()",
  "to-json":
    "(() => { const x = X; try { return JSON.stringify({ toJSON: F.bind(null, x) }); } catch (e) { return e.constructor.name; } })()",
  "to-primitive":
    "(() => { const x = X; try { return `${{ [Symbol.toPrimitive]: F.bind(null, x) }}`; } catch (e) { return e.constructor.name; } })()",
  "replacer":
    "(() => { const x = X; try { return JSON.stringify(1, F.bind(null, x)); } catch (e) { return e.constructor.name; } })()",
  "reviver":
    '(() => { const x = X; try { return JSON.parse("1", F.bind(null, x)); } catch (e) { return e.constructor.name; } })()',
  "replace":
    '(() => { const x = X; try { return "a".replace("a", F.bind(null, x)); } catch (e) { return e.constructor.name; } })()',
  "replace-regexp":
    '(() => { const x = X; try { return "a".replace(/a/g, F.bind(null, x)); } catch (e) { return e.constructor.name; } })()',
  "proxy-get":
    "(() => { const x = X; try { return new Proxy({}, { get: F.bind(null, x) }).p; } catch (e) { return e.constructor.name; } })()",
  "proxy-apply":
    "(() => { const x = X; try { return new Proxy(function () {}, { apply: F.bind(null, x) })(); } catch (e) { return e.constructor.name; } })()",
  "proxy-of-function": "new Proxy(F, {})(X)",
  "has-instance":
    "(() => { const x = X; try { return 1 instanceof { [Symbol.hasInstance]: F.bind(null, x) }; } catch (e) { return e.constructor.name; } })()",
  "iterator-method":
    "(() => { const x = X; try { return [...{ [Symbol.iterator]: F.bind(null, x) }]; } catch (e) { return e.constructor.name; } })()",
  "next-method":
    "(() => { const x = X; try { return (([q]) => q)({ [Symbol.iterator]() { return { next: F.bind(null, x) }; } }); } catch (e) { return e.constructor.name; } })()",
  "dispose": "(() => { const x = X; { using d = { [Symbol.dispose]: F.bind(null, x) }; } })()",
  "disposable-stack-adopt": "(() => { const d = new DisposableStack(); d.adopt(X, F); d.dispose(); })()",
  "disposable-stack-defer":
    "(() => { const x = X; const d = new DisposableStack(); d.defer(F.bind(null, x)); d.dispose(); })()",
  "event-listener":
    '(() => { const x = X; const t = new EventTarget(); t.addEventListener("e", F.bind(null, x)); t.dispatchEvent(new Event("e")); })()',
  "handle-event":
    '(() => { const x = X; const t = new EventTarget(); t.addEventListener("e", { handleEvent: F.bind(null, x) }); t.dispatchEvent(new Event("e")); })()',
  "emitter": '(() => { process.once("first", F); process.emit("first", X); })()',
  "tagged-template": "(() => { const x = X; return F.bind(null, x)``; })()",
  "class-method": "(() => { class K {} K.prototype.run = F; return new K().run(X); })()",
  "static-method": "(() => { class K { static run = F; } return K.run(X); })()",
  "construct-executor": "(() => { const x = X; new Promise(F.bind(null, x)); })()",
  "typed-for-each": "(() => { const x = X; new Uint8Array(1).forEach(F.bind(null, x)); })()",
  "typed-from":
    "(() => { const x = X; try { Uint8Array.from([1], F.bind(null, x)); } catch (e) { return e.constructor.name; } })()",
  "url-search-params": '(() => { const x = X; new URLSearchParams("a=1").forEach(F.bind(null, x)); })()',
  "headers-for-each": '(() => { const x = X; new Headers({ a: "1" }).forEach(F.bind(null, x)); })()',
  "get-or-insert-computed": "(() => { const x = X; return new Map().getOrInsertComputed(1, F.bind(null, x)); })()",
};
const asynchronousTakers: Record<string, string> = {
  "then": "await Promise.resolve(X).then(F)",
  "catch": "await Promise.reject(X).catch(F)",
  "finally": "await (() => { const x = X; return Promise.resolve(1).finally(F.bind(null, x)); })()",
  "timeout": "await new Promise(r => { setTimeout(F, 0, X); setTimeout(r, 1); })",
  "immediate": "await new Promise(r => { setImmediate(F, X); setTimeout(r, 1); })",
  "next-tick": "await new Promise(r => { process.nextTick(F, X); setTimeout(r, 1); })",
  "microtask": "await (() => { const x = X; queueMicrotask(F.bind(null, x)); })()",
  "thenable": "await (() => { const x = X; const f = F; return { then(r) { f(x); r(1); } }; })()",
  "then-is-built-in":
    "await Promise.race([(() => { const x = X; return { then: F.bind(null, x) }; })(), new Promise(r => setTimeout(r, 1))])",
  "promise-try": "await Promise.try(F, X)",
  "from-async": "await Array.fromAsync([X], F)",
  "stream-start": "await (() => { const x = X; new ReadableStream({ start: F.bind(null, x) }); })()",
};

// Object.assign stores into its target: how the source came by a value, and what on the target takes it.
const sourcesOfAssignment: Record<string, [source: string, setup: string]> = {
  "spread-beside-a-name": [`{ a: 1, ...more }`, ``],
  "spread-alone": [`{ ...more }`, ``],
  "name-behind-the-spread": [`{ ...more, a: 1 }`, ``],
  "two-spreads": [`{ ...first, ...more }`, `const first = { a: 1 };`],
  "spread-of-a-spread": [`{ z: 0, ...{ a: 1, ...more } }`, ``],
  "assign-made": [`Object.assign({ a: 1 }, more)`, ``],
  "assign-of-an-assign": [`Object.assign({}, Object.assign({ a: 1 }, more))`, ``],
  "assign-then-variable": [`s`, `const s = { a: 1 }; Object.assign(s, more);`],
  "spread-in-a-variable": [`s`, `const s = { a: 1, ...more };`],
  "spread-in-a-function": [`make(more)`, `function make(m) { return { a: 1, ...m }; }`],
  "rest-pattern": [`rest`, `const { drop, ...rest } = { drop: 0, a: 1, ...more };`],
  "rest-of-more": [`rest`, `const { none, ...rest } = more;`],
  "from-entries": [`Object.fromEntries(Object.entries(more))`, ``],
  "by-descriptors": [`Object.defineProperties({ a: 1 }, Object.getOwnPropertyDescriptors(more))`, ``],
  "create-by-descriptors": [`Object.create(null, Object.getOwnPropertyDescriptors(more))`, ``],
  "stored-by-name": [`s`, `const s = { a: 1 }; s.b = more.b;`],
  "stored-by-key": [`s`, `const s = { a: 1 }; for (const k of Object.keys(more)) s[k] = more[k];`],
  "stored-through-a-global": [
    `s`,
    `const s = { a: 1 }; globalThis.holder = s; globalThis[["hol", "der"].join("")].b = more.b;`,
  ],
  "getter-of-more": [`{ a: 1, ...{ get b() { return more.b; } } }`, ``],
  "getter-of-the-source": [`{ a: 1, get b() { return more.b; } }`, ``],
  "instance": [`{ a: 1, ...new (class { b = more.b; })() }`, ``],
  "array-source": [`{ a: 1, ...[more.b] }`, ``],
  "proxy-of-a-spread": [`new Proxy({ a: 1, ...more }, {})`, ``],
  "second-source": [`{ a: 1 }, { c: 2, ...more }`, ``],
};
const assignedValues: Record<string, string> = {
  text: `"other"`,
  object: `{ k: "deep" }`,
  function: `() => "called"`,
  number: `2.5`,
};
const shown = `(typeof x === "function" ? x() : typeof x === "object" && x !== null ? x.k : x)`;
const targetsOfAssignment: Record<string, string> = {
  "setter": `{ set b(x) { console.log("b", typeof x, ${shown}); }, set 0(x) { console.log("0", typeof x, ${shown}); } }`,
  "class-setter": `new (class { set b(x) { console.log("b", typeof x, ${shown}); } set 0(x) { console.log("0", typeof x, ${shown}); } })()`,
  "inherited-setter": `Object.create({ set b(x) { console.log("b", typeof x, ${shown}); }, set 0(x) { console.log("0", typeof x, ${shown}); } })`,
  "setter-that-keeps": `{ set b(x) { this.kept = x; }, set 0(x) { this.kept = x; } }`,
  "defined-setter": `Object.defineProperty({}, "b", { set(x) { console.log("b", typeof x, ${shown}); } })`,
  "proxy": `new Proxy({}, { set(t, k, x) { console.log(String(k), typeof x, ${shown}); return true; } })`,
  "data": `{ b: 0 }`,
};
const assignment = (source: string, setup: string, value: string, target: string) => `const more = { b: ${value} };
${setup}
function main() {
  const r = Object.assign(${target}, ${source});
  const x = r.kept ?? r.b ?? r[0];
  console.log(typeof x, ${shown}, typeof r.a);
}
try {
  main();
} catch (e) {
  console.log("threw", e.constructor.name);
}
`;

// A built-in that is bound to its receiver and to no argument is called with arguments that change numbers, kinds, lengths and names: by another built-in, by a job, by a timer.
const boundBuiltIns: Record<string, [setup: string, callee: string, operands: string, reads: string]> = {
  "push": [`const x = [1, 2, 3];`, `x.push.bind(x)`, `1.5`, `x[3] === 1.5, x[3] * 2, x.length`],
  "push-large": [`const x = [1, 2, 3];`, `x.push.bind(x)`, `2 ** 40`, `x[3] === 2 ** 40, x[3] + 1, x[3] > 3`],
  "push-negative-zero": [`const x = [1, 2, 3];`, `x.push.bind(x)`, `-0`, `Object.is(x[3], -0), 1 / x[3]`],
  "push-nan": [`const x = [1, 2, 3];`, `x.push.bind(x)`, `NaN`, `x[3] !== x[3], x[3] | 0`],
  "push-undefined": [`const x = [1, 2, 3];`, `x.push.bind(x)`, `undefined`, `x[3] === undefined, x.length, x[3] + 1`],
  "push-onto-empty": [`const x = [];`, `x.push.bind(x)`, `1.5`, `x[0] === 1.5, x[0] * 2, x.length`],
  "push-onto-fractions": [`const x = [0.5];`, `x.push.bind(x)`, `"s"`, `typeof x[1], x[1] + 1`],
  "push-borrowed": [`const x = [1, 2, 3];`, `Array.prototype.push.bind(x)`, `1.5`, `x[3] === 1.5, x[3] * 2`],
  "unshift": [`const x = [1, 2, 3];`, `x.unshift.bind(x)`, `1.5`, `x[0] === 1.5, x[0] * 2, x[3]`],
  "fill": [`const x = [1, 2, 3];`, `x.fill.bind(x)`, `1.5`, `x[0] === 1.5, x[0] * 2`],
  "splice": [`const x = [1, 2, 3];`, `x.splice.bind(x)`, `0, 1, 1.5`, `x[0] === 1.5, x[0] * 2, x.length`],
  "splice-cut": [`const x = [1, 2, 3];`, `x.splice.bind(x)`, `0, 2`, `x.length, x[0], x[1], x[2]`],
  "pop": [`const x = [1, 2, 3];`, `x.pop.bind(x)`, ``, `x.length, x[2], 2 in x`],
  "shift": [`const x = [1, 2, 3];`, `x.shift.bind(x)`, ``, `x.length, x[0], x[2]`],
  "reverse": [`const x = [1, 2, 3];`, `x.reverse.bind(x)`, ``, `x[0], x[0] === 3`],
  "sort": [`const x = [3, 1, 2];`, `x.sort.bind(x)`, `undefined`, `x[0], x[0] === 1`],
  "copy-within": [`const x = [1, 2, 3];`, `x.copyWithin.bind(x)`, `0, 2`, `x[0], x[0] === 3`],
  "assign": [
    `const x = { a: 1 };`,
    `Object.assign.bind(Object)`,
    `x, { a: 1.5, z: "new" }`,
    `x.a === 1.5, x.a * 2, x.z`,
  ],
  "reflect-set": [`const x = { a: 1 };`, `Reflect.set.bind(Reflect)`, `x, "a", 1.5`, `x.a === 1.5, x.a * 2`],
  "reflect-set-kind": [`const x = { a: 1 };`, `Reflect.set.bind(Reflect)`, `x, "a", "text"`, `typeof x.a, x.a + 1`],
  "reflect-set-element": [`const x = [1, 2, 3];`, `Reflect.set.bind(Reflect)`, `x, 0, 1.5`, `x[0] === 1.5, x[0] * 2`],
  "reflect-set-length": [
    `const x = [1, 2, 3];`,
    `Reflect.set.bind(Reflect)`,
    `x, "length", 6`,
    `x.length, x[4], 4 in x`,
  ],
  "define": [
    `const x = { a: 1 };`,
    `Object.defineProperty.bind(Object)`,
    `x, "a", { value: 1.5 }`,
    `x.a === 1.5, x.a * 2`,
  ],
  "define-getter": [
    `const x = { a: 1 };`,
    `Object.defineProperty.bind(Object)`,
    `x, "a", { get() { return "got"; } }`,
    `x.a, typeof x.a`,
  ],
  "define-element": [
    `const x = [1, 2, 3];`,
    `Object.defineProperty.bind(Object)`,
    `x, 0, { get() { return "got"; } }`,
    `x[0], typeof x[0]`,
  ],
  "delete": [`const x = { a: 1 };`, `Reflect.deleteProperty.bind(Reflect)`, `x, "a"`, `x.a, "a" in x`],
  "delete-element": [`const x = [1, 2, 3];`, `Reflect.deleteProperty.bind(Reflect)`, `x, 1`, `x[1], 1 in x, x[1] + 1`],
  "prototype": [
    `const x = { a: 1 };`,
    `Object.setPrototypeOf.bind(Object)`,
    `x, { inherited: 7 }`,
    `x.inherited, "inherited" in x`,
  ],
  "freeze": [
    `const x = { a: 1 };`,
    `Object.freeze.bind(Object)`,
    `x`,
    `(() => { try { x.a = 2; } catch {} return x.a; })(), Object.isFrozen(x)`,
  ],
  "freeze-array": [
    `const x = [1, 2, 3];`,
    `Object.freeze.bind(Object)`,
    `x`,
    `(() => { try { x[0] = 9; x.push(4); } catch {} return x[0] + " " + x.length; })()`,
  ],
  "map-set": [`const x = new Map([["k", 1]]);`, `x.set.bind(x)`, `"k", 1.5`, `x.get("k") === 1.5, x.get("k") * 2`],
  "map-delete": [`const x = new Map([["k", 1]]);`, `x.delete.bind(x)`, `"k"`, `x.size, x.get("k"), x.has("k")`],
  "map-clear": [`const x = new Map([["k", 1]]);`, `x.clear.bind(x)`, ``, `x.size, x.get("k")`],
  "set-add": [`const x = new Set([1]);`, `x.add.bind(x)`, `1.5`, `x.has(1.5), x.size, [...x][1] * 2`],
  "typed-set": [`const x = new Uint8Array(2);`, `x.set.bind(x)`, `[7]`, `x[0], x[0] === 7`],
  "typed-fill": [`const x = new Float64Array(2);`, `x.fill.bind(x)`, `1.5`, `x[0], x[0] === 1.5`],
  "resize": [
    `const b = new ArrayBuffer(8, { maxByteLength: 16 }); const x = new Uint8Array(b);`,
    `b.resize.bind(b)`,
    `0`,
    `x.length, x[0], b.byteLength`,
  ],
  "transfer": [
    `const b = new ArrayBuffer(8); const x = new Uint8Array(b);`,
    `b.transfer.bind(b)`,
    ``,
    `x.length, x[0], b.byteLength`,
  ],
  "date": [`const x = new Date(0);`, `x.setTime.bind(x)`, `5`, `x.getTime(), x.getTime() === 5`],
  "regexp": [`const x = /a/g;`, `x.test.bind(x)`, `"aa"`, `x.lastIndex, x.lastIndex === 1`],
  "instance-push": [
    `class K { a = 1; } const x = new K();`,
    `Array.prototype.push.bind(x)`,
    `"s"`,
    `x.length, x[0], x.a`,
  ],
  "capture": [`const x = { a: 1 };`, `Error.captureStackTrace.bind(Error)`, `x`, `typeof x.stack, x.a`],
  "url": [
    `const x = new URL("http://a/?k=1"); const p = x.searchParams;`,
    `p.set.bind(p)`,
    `"k", "2"`,
    `x.search, p.get("k"), x.href`,
  ],
  "headers": [`const x = new Headers({ k: "1" });`, `x.set.bind(x)`, `"k", "2"`, `x.get("k")`],
};
/** The call, or nothing where the caller cannot pass such operands. */
const callersOfBoundBuiltIns: Record<string, (callee: string, operands: string) => string | undefined> = {
  "timer": (f, a) => `await new Promise(r => { setTimeout(${f}${a ? ", 0, " + a : ""}); setTimeout(r, 2); })`,
  "immediate": (f, a) => `await new Promise(r => { setImmediate(${f}${a ? ", " + a : ""}); setTimeout(r, 2); })`,
  "tick": (f, a) => `await new Promise(r => { process.nextTick(${f}${a ? ", " + a : ""}); setTimeout(r, 2); })`,
  "reflect-apply": (f, a) => `Reflect.apply(${f}, undefined, [${a}])`,
  "apply": (f, a) => `(${f}).apply(undefined, [${a}])`,
  "call": (f, a) => `(${f}).call(undefined${a ? ", " + a : ""})`,
  "promise-try": (f, a) => `await Promise.try(${f}${a ? ", " + a : ""})`,
  "direct": (f, a) => `(${f})(${a})`,
  "bound-again": (f, a) => `(${f}).bind(undefined)(${a})`,
  "getter": (f, a) => (a ? undefined : `void Object.defineProperty({}, "g", { get: ${f} }).g`),
  "microtask": (f, a) => (a ? undefined : `await (queueMicrotask(${f}), 0)`),
  "then": (f, a) =>
    !a ? `await Promise.resolve().then(${f})` : a.includes(",") ? undefined : `await Promise.resolve(${a}).then(${f})`,
  "for-each": (f, a) => (a && !a.includes(",") && !a.includes("{") ? `[${a}].forEach(${f})` : undefined),
  "emitter": (f, a) => `(process.once("first", ${f}), process.emit("first"${a ? ", " + a : ""}))`,
  "listener": (f, a) =>
    a ? undefined : `(t => { t.addEventListener("e", ${f}); t.dispatchEvent(new Event("e")); })(new EventTarget())`,
};
const callOfBoundBuiltIn = (setup: string, call: string, reads: string) => `async function main() {
  ${setup}
  console.log("before", ${reads});
  ${call};
  console.log("behind", ${reads});
  let last = "";
  for (let turn = 0; turn < 20000; turn++) last = [${reads}].join();
  console.log(last);
}
try {
  await main();
} catch (e) {
  console.log("threw", e.constructor.name);
}
`;

/** Array methods hand their callback the array too, which holds the first operand: a validating build takes that operand for one that Object.assign keeps. */
const handsOverTheArray = [
  "every",
  "filter",
  "find",
  "find-last-index",
  "flat-map",
  "for-each",
  "map",
  "reduce-direct",
  "some",
];
const assignsFromEveryOperand = ["assign-to-o", "instance-assign"];
/** What their callback throws does not come back to the caller: the process would end with it. A buffer can be transferred once, and each program takes three turns. */
const reportsElsewhereWhatTheCallbackThrows = [
  "construct-executor",
  "emitter",
  "event-listener",
  "handle-event",
  "immediate",
  "microtask",
  "next-tick",
  "timeout",
];

const state = `let hits = 0;
let v = 1;
let w = [1, 2, 3];
let fnv = () => "old";
class C {
  x = 1;
  m() {
    return "old";
  }
}`;
const locals = `  const o = { a: 1, b: 2, f: () => "old" };
  const arr = [1, 2, 3];
  const c = new C();
  const buf = new ArrayBuffer(8, { maxByteLength: 16 });
  const ta = new Uint8Array(buf);
  const dv = new DataView(buf);
  const buf2 = new ArrayBuffer(8);
  const ta2 = new Int32Array(buf2);
  const m = new Map([["k", 1]]);
  const st = new Set([1, 2]);
  ta[0] = 5;
  ta2[0] = 6;`;
const reads = `o.a, o.b, o.z, o.inherited, "a" in o, typeof o.stack, o.f(), arr.length, arr[0], arr[1], arr[2], arr[3], v, c.m(), c.x, c.length, c[0], ta.length, ta[0], ta.byteLength, ta2.length, ta2[0], m.size, m.get("k"), st.has(1), st.size, w[0], w.length, fnv()`;

const program = (trigger: string, change: string | undefined, isAsynchronous: boolean) => `${state}
${isAsynchronous ? "async " : ""}function main() {
${locals}${
  change === undefined
    ? ""
    : `
  const change = () => {
    if (++hits === 2) {
      ${change}
    }
  };`
}
  for (let i = 0; i < 3; i++) {
    console.log("before", ${reads});
    const r = ${trigger};
    console.log("behind", ${reads});
    try {
      o.b = i + 10;
      o.y = i;
      arr[2] = i + 20;
      c.x = i + 30;
    } catch (e) {
      console.log(e.constructor.name);
    }
    console.log(typeof r, hits, o.b, o.y, arr[2], c.x);
  }
}
try {
  ${isAsynchronous ? "await " : ""}main();
} catch (e) {
  console.log("threw", e.constructor.name);
}
`;

export function programs(): WrittenProgram[] {
  const files: Record<string, string> = {};
  for (const [table, isAsynchronous] of [
    [triggers, false],
    [asynchronousTriggers, true],
  ] as const)
    for (const [name, trigger] of Object.entries(table))
      for (const [changeName, change] of Object.entries(changes))
        files[`${name}--${changeName}.mjs`] = program(trigger, change, isAsynchronous);
  for (const [table, isAsynchronous] of [
    [takers, false],
    [asynchronousTakers, true],
  ] as const)
    for (const [taker, text] of Object.entries(table))
      for (const [handed, [callee, operand]] of Object.entries(changingBuiltIns)) {
        if (handed === "transfer" && reportsElsewhereWhatTheCallbackThrows.includes(taker)) continue;
        files[`${taker}-is-handed--${handed}.mjs`] = program(
          text.replace(/\bF\b/g, () => `(${callee})`).replace(/\bX\b/g, () => `(${operand})`),
          undefined,
          isAsynchronous,
        );
        if (handsOverTheArray.includes(taker) && assignsFromEveryOperand.includes(handed))
          files[`${taker}-is-handed--${handed}.json`] = JSON.stringify({
            skipInVariants: "a validating build stops where one source of Object.assign holds another",
          });
      }
  for (const [how, [source, setup]] of Object.entries(sourcesOfAssignment))
    for (const [kind, value] of Object.entries(assignedValues))
      for (const [taker, target] of Object.entries(targetsOfAssignment))
        files[`assigned-from--${how}--${kind}--${taker}.mjs`] = assignment(source, setup, value, target);
  for (const [name, [setup, callee, operands, reads]] of Object.entries(boundBuiltIns))
    for (const [caller, callOf] of Object.entries(callersOfBoundBuiltIns)) {
      const call = callOf(callee, operands);
      if (call !== undefined) files[`bound--${name}--${caller}.mjs`] = callOfBoundBuiltIn(setup, call, reads);
    }
  return programsOf(files);
}
