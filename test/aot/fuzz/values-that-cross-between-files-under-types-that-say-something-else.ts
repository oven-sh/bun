// Small programs of two to five files in which one value crosses from the file that makes it into a file that uses it, under a type that may say something else than what arrives. TypeScript accepts
// every program: where the type and the value disagree, something hides it from the checker. A type changes nothing about what a program prints, so the executable prints what plain Bun prints.
// Everything is used once unless the draw says otherwise, no two programs share a head, and every line is printed at once, by `console.log` itself. In this order are drawn:
//
//   the corner     a declaration file beside JavaScript; one that is invalid itself, under `skipLibCheck`; JSDoc, with `checkJs` on and off; types inferred from JavaScript that another file then uses
//                  otherwise; JavaScript without any types; a package in node_modules with "types", "exports", typings of its own name under @types, or none; `declare module`, `declare global`,
//                  `declare const`; TypeScript that hides a mistake from TypeScript; TypeScript with a type that is invalid itself, on a line or in a file that is not checked; JavaScript that calls into
//                  TypeScript; JavaScript alone
//   the direction  the user calls the maker; reads its constant, a member of its object, awaits it; the maker calls the user's function, constructor, method or setter, or stores to its field; the user hands the
//                  maker a callback; registers it in a third file; a first file takes from the one and gives to the other
//   the files      .ts .mts .cts .tsx .js .mjs .cjs .jsx, files between that export again (`export {}`, `export *`, `export * as`, an import exported) or hand on by a function, typed, untyped or generic
//   the reach      an import by name, under another name, of the namespace; `require`, `createRequire`, `import()`; a cycle between the two files
//   what hides     `as any`, `as unknown as T`, `!`, a variable of type `any`, `// @ts-ignore`, `// @ts-expect-error`, `// @ts-nocheck`, `JSON.parse`, a `Map<any, any>`, `Reflect.get`, a generic function that casts
//   the type       number, string, boolean, bigint, an object type, one with an optional member, a read-only one, a class, a list, a tuple, unions of literals, of primitives and of objects, an enum, a function,
//                  an index signature, a generic box; written in place, under a name of each file's own, or in a file of types
//   what arrives   what the type says; what it says in another representation; a primitive of another kind; `null`, `undefined`; an object with a member missing, more, of another kind, as an accessor, on the
//                  prototype; an instance of another class, of a class below, made by `Object.create` or `Reflect.construct`, a proxy, frozen; a list with holes, of other elements, like a list; a function
//                  with other parameters or another result, a class, an async function, a generator
//   what is done   members read by name, key and pattern; arithmetic; comparisons; methods; stores; spreads, rests, keys, JSON; `typeof`, `instanceof`, `in`, `Array.isArray`; `switch`; templates; it is handed
//                  to one more file; kept in a typed variable, field, list, map or closure and read later; once, or in a loop of ten thousand turns
import type { Random } from "./random";

export const corners = [
  "a declaration file beside JavaScript",
  "a declaration file that is invalid itself",
  "JSDoc",
  "types inferred from JavaScript",
  "JavaScript without types",
  "a package",
  "an ambient declaration",
  "TypeScript hides it from TypeScript",
  "TypeScript with a type that is invalid itself",
  "JavaScript calls TypeScript",
  "JavaScript alone",
] as const;
export type Corner = (typeof corners)[number];

/** In a use `$` is the value. What stands in ‹› is written in TypeScript alone. A use without `console.log` is an expression. */
type Kind = {
  type: string;
  /** Declarations that the type names: a file of its own. */
  needs?: "Shape" | "Color";
  isObjectType?: true;
  /** What the type says, as anybody would write it. */
  plain: string[];
  /** What the type says, in a form that is seldom seen. */
  fits: string[];
  /** What it does not say. */
  other: string[];
  /** Texts for JSON.parse. */
  json: string[];
  uses: string[];
};

const primitivesOfOtherKinds = /^(?:"[^"]*"|-?\d[\d.e]*n?|true|false|Symbol\("s"\))$/;

const kinds: Record<string, Kind> = {
  number: {
    type: "number",
    plain: ["7", "3"],
    fits: ["2.5", "-0", "NaN", "2147483648", "4294967301", "-2147483649", "9007199254740993", "1e300", "Infinity"],
    other: [
      `"7"`,
      `"text"`,
      `""`,
      "true",
      "null",
      "undefined",
      "7n",
      `Symbol("s")`,
      "{ valueOf() { return 7; } }",
      "[7]",
      "new Number(7)",
      "() => 7",
      "{}",
      "new Date(7)",
    ],
    json: [`"7"`, "null", "[7]", "{}", "true", "2.5", "1e300", "4294967301", "-0"],
    uses: [
      "$ + 1",
      "1 + $",
      "$ * 2",
      "$ - 1",
      "$ / 2",
      "$ % 3",
      "$ ** 2",
      "$ | 0",
      "$ >>> 0",
      "$ << 1",
      "$ & 255",
      "~$",
      "-$",
      "+$",
      "$ < 5",
      "$ >= 7",
      "$ === 7",
      "$ !== 7",
      "$ == 7",
      `$ > 5 ? "more" : "less"`,
      "`<${$}>`",
      `"" + $`,
      "$.toFixed(1)",
      "$.toString()",
      "$.toString(2)",
      "$.valueOf()",
      "Math.floor($)",
      "Math.max($, 1)",
      "Math.abs($)",
      "Math.sqrt($)",
      "Math.round($)",
      "Math.imul($, 3)",
      "[10, 20, 30, 40, 50, 60, 70, 80][$]",
      `"abcdefghij".charAt($)`,
      `"abcdefghij"[$]`,
      `"abcdefghij".slice($)`,
      "typeof $",
      `typeof $ === "number" ? $ + 1 : "no number"`,
      `typeof $ !== "number" ? "no number" : $ * 2`,
      "Number.isInteger($)",
      "Number.isSafeInteger($)",
      "isNaN($)",
      "Number.isNaN($)",
      "Object.is($, -0)",
      "Object.is($, 7)",
      "String($)",
      "Number($)",
      "Boolean($)",
      `$ ? "yes" : "no"`,
      "!$",
      `$ ?? "none"`,
      `$ || "none"`,
      "$ && 1",
      "JSON.stringify({ held: $ })",
      "JSON.stringify([$])",
      "[$, $].join()",
      "new Array‹<number>›(2).fill($).join()",
      "[1, 2, 3].indexOf($)",
      "[7, 8].includes($)",
      "new Set([7]).has($)",
      `new Map([[7, "seven"]]).get($)`,
      'BigInt.asIntN(8, 1n) + BigInt(typeof $ === "number" && Number.isInteger($) ? 1 : 0)',
      `switch ($) {\ncase 7:\nconsole.log("seven");\nbreak;\ncase 3:\nconsole.log("three");\nbreak;\ndefault:\nconsole.log("another");\n}`,
      "let counted = $;\ncounted++;\nconsole.log(counted);",
      "let summed = 0;\nsummed += $;\nconsole.log(summed);",
      "let summed = 0;\nfor (let step = 0; step < 3; step++) summed += $;\nconsole.log(summed);",
      "const list‹: number[]› = [1, 2];\nlist[1] = $;\nconsole.log(list[1] + 1);",
      "const list‹: number[]› = [];\nlist.push($);\nconsole.log(list[0] * 2, list.length);",
      "const floats = new Float64Array(1);\nfloats[0] = $;\nconsole.log(floats[0]);",
      "const bytes = new Int32Array(1);\nbytes[0] = $;\nconsole.log(bytes[0]);",
      "for (let step = 0; step < $; step++) {\nif (step > 8) break;\nconsole.log(step);\n}",
    ],
  },
  string: {
    type: "string",
    plain: [`"text"`, `"ab"`],
    fits: [
      `""`,
      `"é"`,
      `"\\u{1F600}"`,
      `"7"`,
      `"a".repeat(3)`,
      `"__proto__"`,
      `"length"`,
      "`${1}${2}`",
      `["a", "b"].join("")`,
    ],
    other: [
      "7",
      "0",
      "null",
      "undefined",
      "true",
      `["t", "e"]`,
      "{ length: 2 }",
      `new String("text")`,
      `Symbol("s")`,
      "7n",
      `{ toString() { return "made"; } }`,
      "{}",
      "/text/",
      `() => "text"`,
    ],
    json: ["7", "null", `["t"]`, `{"length":2}`, "true", `""`, `"é"`],
    uses: [
      "$.length",
      `$ + "!"`,
      `"<" + $ + ">"`,
      "$ + $",
      "$.toUpperCase()",
      "$[0]",
      "$.charCodeAt(0)",
      "$.charAt(1)",
      "$.codePointAt(0)",
      "$.at(-1)",
      `$ === "text"`,
      `$ !== "text"`,
      `$ == "7"`,
      `$ < "u"`,
      "`<${$}>`",
      "$.slice(1)",
      "$.substring(0, 1)",
      `$.split("").length`,
      "[...$].length",
      `$.indexOf("e")`,
      `$.includes("e")`,
      `$.startsWith("t")`,
      `$.concat("!")`,
      "$.padStart(6)",
      "$.repeat(2)",
      "$.trim()",
      `$.replace("t", "T")`,
      '$.localeCompare("text")',
      "/e/.test($)",
      "$.match(/e/)?.index",
      "typeof $",
      `typeof $ === "string" ? $.length : "no string"`,
      `typeof $ !== "string" ? "no string" : $ + "!"`,
      "JSON.stringify($)",
      "JSON.stringify({ held: $ })",
      "parseInt($)",
      "Number($)",
      "String($)",
      "+$",
      `$ || "empty"`,
      `$ ?? "none"`,
      `$ ? "yes" : "no"`,
      "!$",
      `({ text: 1, ab: 2 }‹ as Record<string, number>›)[$]`,
      `$ in { text: 1 }`,
      `new Map([["text", 1]]).get($)`,
      `new Set(["text"]).has($)`,
      `["text", "ab"].indexOf($)`,
      "encodeURIComponent($)",
      "[$, $].join()",
      `switch ($) {\ncase "text":\nconsole.log("the text");\nbreak;\ncase "7":\nconsole.log("seven");\nbreak;\ndefault:\nconsole.log("another");\n}`,
      "for (const part of $) console.log(part);",
      "for (let at = 0; at < $.length; at++) console.log($[at]);",
      `let joined = "";\njoined += $;\nconsole.log(joined);`,
      `let joined = "";\nfor (let step = 0; step < 3; step++) joined += $;\nconsole.log(joined, joined.length);`,
      `const record‹: Record<string, number>› = {};\nrecord[$] = 1;\nconsole.log(Object.keys(record).join());`,
      "const list‹: string[]› = [];\nlist.push($);\nconsole.log(list[0].length);",
    ],
  },
  boolean: {
    type: "boolean",
    plain: ["true", "false"],
    fits: ["!0", "1 > 2"],
    other: ["0", "1", `""`, `"false"`, "null", "undefined", "NaN", "{}", "[]", "new Boolean(false)", "0n", "-0"],
    json: ["0", "1", `""`, `"false"`, "null", "{}", "[]"],
    uses: [
      "$ ? 1 : 2",
      "!$",
      "!!$",
      "$ === true",
      "$ === false",
      "$ !== true",
      "$ == true",
      `$ && "yes"`,
      `$ || "no"`,
      `$ ?? "none"`,
      "typeof $",
      `typeof $ === "boolean" ? "a boolean" : "none"`,
      "Number($)",
      "+$",
      "String($)",
      "`${$}`",
      "$.toString()",
      "$.valueOf()",
      "[true].includes($)",
      "JSON.stringify({ held: $ })",
      "Object.is($, false)",
      `if ($) console.log("taken");\nelse console.log("not taken");`,
      `if (!$) console.log("not taken");\nelse console.log("taken");`,
      `switch ($) {\ncase true:\nconsole.log("true");\nbreak;\ncase false:\nconsole.log("false");\nbreak;\ndefault:\nconsole.log("neither");\n}`,
      `let turns = 0;\nwhile ($) {\nif (++turns > 2) break;\n}\nconsole.log(turns);`,
      "const flags‹: boolean[]› = [];\nflags.push($);\nconsole.log(flags[0] === true, flags[0] === false);",
    ],
  },
  bigint: {
    type: "bigint",
    plain: ["7n"],
    fits: ["0n", "-1n", "2n ** 64n", "BigInt(7)"],
    other: ["7", `"7"`, "null", "undefined", "true", "2.5", "{}", "Object(7n)"],
    json: ["7", `"7"`, "null", "true"],
    uses: [
      "$ + 1n",
      "$ * 2n",
      "-$",
      "$ === 7n",
      "$ == 7n",
      "$ < 10n",
      "$ > 5",
      "typeof $",
      "$.toString()",
      "BigInt.asIntN(8, $)",
      "Number($)",
      "String($)",
      "`${$}`",
      `$ ? "yes" : "no"`,
      `typeof $ === "bigint" ? $ + 1n : "no bigint"`,
      "let counted = $;\ncounted++;\nconsole.log(counted);",
    ],
  },
  pair: {
    type: "{ a: number; b: string }",
    isObjectType: true,
    plain: [`{ a: 1, b: "two" }`],
    fits: [
      `{ b: "two", a: 1 }`,
      `{ a: 1.5, b: "two" }`,
      `{ a: -0, b: "" }`,
      `{ a: 4294967301, b: "two" }`,
      `Object.freeze({ a: 1, b: "two" })`,
      `new (class { a = 1; b = "two"; })()`,
      `{ get a() { return 1; }, b: "two" }`,
      `new Proxy({ a: 1, b: "two" }, {})`,
      `{ ...{ a: 1 }, b: "two" }`,
      `Object.assign({ a: 1 }, { b: "two" })`,
    ],
    other: [
      "{ a: 1 }",
      `{ b: "two" }`,
      "{}",
      `{ a: 1, b: "two", c: 3 }`,
      `{ c: 3, a: 1, b: "two" }`,
      `{ a: "1", b: 2 }`,
      `{ a: undefined, b: null }`,
      `{ a: 1, b: undefined }`,
      `{ a: 7n, b: "two" }`,
      `{ a: { valueOf() { return 1; } }, b: ["two"] }`,
      `Object.create({ a: 1, b: "two" })`,
      `Object.assign(Object.create(null), { a: 1, b: "two" })`,
      `Object.assign(Object.create({ a: 1 }), { b: "two" })`,
      `Object.defineProperty({ b: "two" }, "a", { value: 1 })`,
      `Object.defineProperty({ a: 1, b: "two" }, "b", { get() { return 2; } })`,
      `new Proxy({}, { get: (_, key) => String(key) })`,
      `new Proxy({ a: 1, b: "two" }, { get: () => 5, ownKeys: () => [] })`,
      "null",
      "undefined",
      "7",
      `"text"`,
      `[1, "two"]`,
      `new Map([["a", 1]])`,
      `Object.assign(() => 1, { a: 1, b: "two" })`,
      `Object.assign([], { a: 1, b: "two" })`,
    ],
    json: [
      `{"a":1}`,
      `{"a":"1","b":2}`,
      `{"b":"two","a":1,"c":3}`,
      "null",
      "7",
      `[1,"two"]`,
      `{"a":1,"b":"two","__proto__":{"c":3}}`,
      `{"a":1.5,"b":"two"}`,
    ],
    uses: [
      "$.a + 1",
      "$.a * 2",
      "$.b.length",
      "$.a + $.b",
      "$.b + $.a",
      "$.a === 1",
      "$.a < 2",
      "typeof $.a",
      "typeof $.b",
      "$.a.toFixed(1)",
      "$.b.toUpperCase()",
      `$["a"]`,
      `$["b"] + "!"`,
      "`${$.a}${$.b}`",
      "Object.keys($).join()",
      "Object.values($).join()",
      "Object.entries($).join()",
      "Object.getOwnPropertyNames($).join()",
      "JSON.stringify($)",
      "JSON.stringify({ ...$ })",
      "JSON.stringify([$])",
      "Object.keys({ ...$ }).join()",
      "Object.keys({ ...$, c: 3 }).join()",
      "Object.keys({ c: 3, ...$ }).join()",
      "Object.keys(Object.assign({}, $)).join()",
      `"a" in $`,
      `"c" in $`,
      `Object.hasOwn($, "a")`,
      `$.hasOwnProperty("a")`,
      "typeof $",
      "$ === null",
      "$ == null",
      "Array.isArray($)",
      "$ instanceof Object",
      "Object.getPrototypeOf($) === Object.prototype",
      "Object.isFrozen($)",
      "String($)",
      "[$].map(each => each.a).join()",
      "const { a, b } = $;\nconsole.log(a, b);",
      "const { a } = $;\nconsole.log(a + 1);",
      "const { b: renamed } = $;\nconsole.log(renamed.length);",
      "const { a, ...rest } = $;\nconsole.log(a, Object.keys(rest).join());",
      `const { a = 5, b = "five" } = $;\nconsole.log(a, b);`,
      "$.a = 5;\nconsole.log($.a);",
      "$.a = 2.5;\nconsole.log($.a + 1, Object.keys($).join());",
      `$.b = "stored";\nconsole.log($.b, $.a);`,
      "$.a++;\nconsole.log($.a);",
      "$.a += 1;\nconsole.log($.a);",
      `$.b += "!";\nconsole.log($.b);`,
      `const key‹: "a" | "b"› = "b";\nconsole.log($[key]);`,
      "for (const key in $) console.log(key);",
      `for (const key of ["a", "b"]‹ as const›) console.log($[key]);`,
      "for (const [key, value] of Object.entries($)) console.log(key, value);",
      "let summed = 0;\nfor (let step = 0; step < 3; step++) summed += $.a;\nconsole.log(summed);",
      `delete ($‹ as { a?: number }›).a;\nconsole.log("a" in $, Object.keys($).join());`,
      "const copy = { ...$ };\ncopy.a = 9;\nconsole.log(copy.a, $.a);",
    ],
  },
  optional: {
    type: "{ a: number; b?: string }",
    isObjectType: true,
    plain: ["{ a: 1 }", `{ a: 1, b: "two" }`],
    fits: ["{ a: 1, b: undefined }", `{ b: "two", a: 1 }`, "Object.freeze({ a: 1 })"],
    other: [
      "{ a: 1, b: null }",
      "{ a: 1, b: 2 }",
      "{ a: 1, b: { length: 3 } }",
      `Object.create({ a: 1, b: "above" })`,
      "{}",
      "null",
      "{ a: 1, get b() { return 2; } }",
      `{ a: 1, b: ["two"] }`,
    ],
    json: [`{"a":1,"b":null}`, `{"a":1,"b":2}`, "{}", "null"],
    uses: [
      "$.b?.length",
      `$.b ?? "none"`,
      `$.b || "none"`,
      `"b" in $`,
      "$.b === undefined",
      "$.b !== undefined ? $.b.length : -1",
      `typeof $.b === "string" ? $.b.toUpperCase() : "no text"`,
      "$.b ? $.b.length : 0",
      "typeof $.b",
      "Object.keys($).join()",
      "JSON.stringify($)",
      "$.b?.toUpperCase()",
      "$.a + ($.b ? 1 : 0)",
      `const { b = "default" } = $;\nconsole.log(b);`,
      `const { a, b } = $;\nconsole.log(a, b);`,
      `$.b = "stored";\nconsole.log(Object.keys($).join(), $.b);`,
      "$.b = undefined;\nconsole.log(Object.keys($).join());",
      "delete $.b;\nconsole.log(Object.keys($).join(), $.b);",
      `if ($.b) console.log($.b.length);\nelse console.log("without");`,
    ],
  },
  readonly: {
    type: "{ readonly a: number; readonly list: readonly number[] }",
    isObjectType: true,
    plain: ["{ a: 1, list: [1, 2] }"],
    fits: [
      "Object.freeze({ a: 1, list: Object.freeze([1, 2]) })",
      "{ list: [], a: 0 }",
      "{ get a() { return Math.floor(2.5); }, list: [1] }",
    ],
    other: [
      `{ a: "1", list: "12" }`,
      "{ a: 1 }",
      "{ a: 1, list: null }",
      "{ a: 1, list: { length: 1, 0: 5 } }",
      "{ a: 1, list: new Uint8Array(2) }",
      "null",
    ],
    json: [`{"a":"1","list":"12"}`, `{"a":1}`, `{"a":1,"list":null}`],
    uses: [
      "$.a + $.a",
      "$.list.length",
      "$.list[0] + 1",
      "$.list.join()",
      "$.list.map(each => each + 1).join()",
      "[...$.list].length",
      "JSON.stringify($)",
      "$.a + $.list.length",
      "const { a, list } = $;\nconsole.log(a, list.length);",
      "const { list: [first] } = $;\nconsole.log(first);",
      "let summed = 0;\nfor (const each of $.list) summed += each;\nconsole.log(summed);",
      "const before = $.a;\n($‹ as { a: number }›).a = 9;\nconsole.log(before, $.a);",
    ],
  },
  shape: {
    type: "Shape",
    needs: "Shape",
    plain: ["new Shape(3)"],
    fits: [
      "new (class extends Shape { area() { return -1; } })(3)",
      "new (class extends Shape { extra = 1; })(3)",
      "new (class extends Shape { get side() { return 5; } set side(_) {} })(3)",
      "Object.freeze(new Shape(3))",
      "new Proxy(new Shape(3), {})",
      "new Shape(2.5)",
      "new Shape(4294967301)",
      "Reflect.construct(Shape, [3])",
      "Object.assign(new Shape(3), { extra: 1 })",
      "Object.assign(new Shape(3), { area() { return -2; } })",
    ],
    other: [
      `new (class Shape { side = 3; name = "shape"; area() { return 9; } get twice() { return 6; } })()`,
      `{ side: 3, name: "literal", area() { return 9; }, twice: 6 }`,
      "{ side: 3 }",
      "Object.create(Shape.prototype)",
      `Object.assign(Object.create(Shape.prototype), { name: "made", side: 3 })`,
      "Reflect.construct(Shape, [3], class Other {})",
      "Reflect.construct(Shape, [3], Object)",
      "Reflect.construct(Object, [], Shape)",
      "Reflect.construct(class { other = 1; }, [], Shape)",
      `new Shape("3")`,
      "new Shape()",
      "new Shape(null)",
      `Object.assign(new Shape(3), { side: "3" })`,
      "Object.assign(new Shape(3), { name: 4 })",
      `Object.defineProperty(new Shape(3), "side", { get() { return 4; } })`,
      `Object.defineProperty(new Shape(3), "side", { value: 4, writable: false })`,
      "Object.setPrototypeOf(new Shape(3), null)",
      `Object.setPrototypeOf(new Shape(3), { area() { return "another"; } })`,
      "Object.setPrototypeOf(new Shape(3), class Other { area() { return 0; } }.prototype)",
      "(shape => (delete shape.side, shape))(new Shape(3))",
      "(shape => (delete shape.name, shape))(new Shape(3))",
      "Shape.prototype",
      "Shape",
      "null",
      "undefined",
      "3",
    ],
    json: [`{"side":3,"name":"parsed"}`, `{"side":"3"}`, "null", "3"],
    uses: [
      "$.side + 1",
      "$.side * $.side",
      "$.area()",
      "$.area() + 1",
      "$.twice",
      "$.name.length",
      "$.name + $.side",
      "typeof $.side",
      "typeof $.area",
      "$ instanceof Shape",
      `$ instanceof Shape ? $.side : "no shape"`,
      "$.constructor === Shape",
      "$.constructor.name",
      "Shape.prototype.area.call($)",
      "$.area === Shape.prototype.area",
      "Object.getPrototypeOf($) === Shape.prototype",
      `Shape.is($) ? $.area() : "no shape"`,
      "Object.keys($).join()",
      "JSON.stringify($)",
      "JSON.stringify({ ...$ })",
      `"side" in $`,
      `"area" in $`,
      `Object.hasOwn($, "side")`,
      "$ === null",
      "typeof $",
      "[$].map(each => each.area()).join()",
      "const { side } = $;\nconsole.log(side + 1);",
      "const { side, name } = $;\nconsole.log(side, name);",
      "const { side, ...rest } = $;\nconsole.log(side, Object.keys(rest).join());",
      "$.side = 4;\nconsole.log($.area());",
      "$.side = 2.5;\nconsole.log($.side, $.twice);",
      "$.side++;\nconsole.log($.side);",
      "$.side += 1;\nconsole.log($.area(), $.side);",
      `$.name = "stored";\nconsole.log($.name, Object.keys($).join());`,
      "const area = $.area;\nconsole.log(area.call($));",
      "let summed = 0;\nfor (let step = 0; step < 3; step++) summed += $.area();\nconsole.log(summed);",
      "for (const key in $) console.log(key);",
    ],
  },
  list: {
    type: "number[]",
    plain: ["[1, 2, 3]"],
    fits: [
      "[]",
      "[1.5, 2, 3]",
      "[2147483648, -0, NaN]",
      "[1, 2, 3].reverse()",
      "Object.freeze([1, 2, 3])",
      "new Proxy([1, 2, 3], {})",
      "new (class extends Array {})(1, 2, 3)",
      "Array.from({ length: 3 }, (_, at) => at)",
      "Array.of(7)",
      "new Array(3).fill(1)",
      "Object.assign([1, 2, 3], { extra: 1 })",
    ],
    other: [
      "[1, , 3]",
      "new Array(3)",
      `[1, "2", 3]`,
      `["a", "b"]`,
      "[1, null, undefined]",
      "[[1], [2]]",
      "[1n, 2n]",
      "[{ valueOf() { return 1; } }, 2]",
      "{ length: 2, 0: 1, 1: 2 }",
      "new Uint8Array([1, 2, 3])",
      "new Float64Array([1.5, 2.5])",
      `"123"`,
      "new Set([1, 2, 3])",
      "null",
      "undefined",
      "7",
      "{}",
      "Object.defineProperty([1, 2, 3], 1, { get() { return 20; } })",
      `Object.defineProperty([1, 2, 3], "length", { writable: false })`,
      "Object.setPrototypeOf([1, 2, 3], null)",
      "Object.setPrototypeOf([1, , 3], { 1: 20 })",
      "Object.setPrototypeOf([1, 2, 3], { join() { return 5; }, map() { return [5]; } })",
      "Object.create([1, 2, 3])",
      "(function () { return arguments; })(1, 2, 3)",
    ],
    json: [
      `[1,"2",3]`,
      `["a","b"]`,
      "[1,null]",
      `{"length":2,"0":1,"1":2}`,
      "null",
      `"123"`,
      "[[1],[2]]",
      "[1.5,2]",
      "[]",
    ],
    uses: [
      "$.length",
      "$[0] + 1",
      "$[1]",
      "$[1] * 2",
      "$[5]",
      "$[$.length - 1]",
      "$.at(-1)",
      "$.join()",
      `$.join("-")`,
      "$.map(each => each + 1).join()",
      "$.map(each => typeof each).join()",
      "$.filter(each => each > 1).length",
      "$.reduce((sum, each) => sum + each, 0)",
      "$.indexOf(2)",
      "$.includes(2)",
      "$.includes(NaN)",
      "$.slice(1).join()",
      "$.concat([9]).length",
      "[...$].length",
      "[...$, 9].join()",
      "[0, ...$].join()",
      "Math.max(...$)",
      "Array.isArray($)",
      `Array.isArray($) ? $.length : "no list"`,
      "typeof $",
      "$ instanceof Array",
      "JSON.stringify($)",
      "Object.keys($).join()",
      "1 in $",
      "new Set($).size",
      "Array.from($).length",
      "$.some(each => each === 2)",
      '$.every(each => typeof each === "number")',
      "$.find(each => each > 1)",
      "$.findIndex(each => each === undefined)",
      "$.flat().length",
      "$.toString()",
      "String($)",
      "$.push(4)",
      "$.pop()",
      "$.shift()",
      "$.unshift(0)",
      "const [first, second] = $;\nconsole.log(first, second);",
      "const [first, ...rest] = $;\nconsole.log(first, rest.length);",
      "const [, second = 5] = $;\nconsole.log(second);",
      "let summed = 0;\nfor (const each of $) summed += each;\nconsole.log(summed);",
      "let summed = 0;\nfor (let at = 0; at < $.length; at++) summed += $[at];\nconsole.log(summed);",
      "let summed = 0;\n$.forEach(each => {\nsummed += each;\n});\nconsole.log(summed);",
      "for (const at in $) console.log(at);",
      "for (const [at, each] of $.entries()) console.log(at, each);",
      "$[0] = 9;\nconsole.log($[0], $.length);",
      "$[1] = 2.5;\nconsole.log($.join());",
      "$[5] = 6;\nconsole.log($.length, 4 in $);",
      "$.length = 1;\nconsole.log($.join());",
      "$.push(4);\nconsole.log($.length, $[$.length - 1]);",
      "$.sort();\nconsole.log($.join());",
      "$.sort((one, other) => other - one);\nconsole.log($.join());",
      "$.reverse();\nconsole.log($[0]);",
      "$.fill(0);\nconsole.log($.join());",
      "$.splice(1, 1);\nconsole.log($.join());",
    ],
  },
  texts: {
    type: "string[]",
    plain: [`["a", "b"]`],
    fits: ["[]", `["", "é"]`, `"a,b".split(",")`, `Object.freeze(["a"])`],
    other: [
      "[1, 2]",
      `["a", , "c"]`,
      `["a", null]`,
      `"ab"`,
      `[["a"]]`,
      `{ length: 1, 0: "a" }`,
      "null",
      `[new String("a")]`,
      `[Symbol("s")]`,
    ],
    json: ["[1,2]", `["a",null]`, `"ab"`, "null"],
    uses: [
      "$[0].length",
      "$[0] + $[1]",
      "$[0].toUpperCase()",
      `$.join("")`,
      "$.map(each => each.length).join()",
      `$.includes("a")`,
      `$.indexOf("b")`,
      "$.length",
      "JSON.stringify($)",
      "[...$].join()",
      `let joined = "";\nfor (const each of $) joined += each;\nconsole.log(joined);`,
      "const [first] = $;\nconsole.log(first.length);",
      `$.push("c");\nconsole.log($.join());`,
      "$.sort();\nconsole.log($.join());",
    ],
  },
  tuple: {
    type: "[number, string]",
    plain: [`[1, "two"]`],
    fits: [`[1.5, ""]`, `Object.freeze([1, "two"])`],
    other: [
      `["two", 1]`,
      "[1]",
      "[]",
      `[1, "two", 3]`,
      "[1, 2]",
      `[, "two"]`,
      "null",
      `{ 0: 1, 1: "two", length: 2 }`,
      `"1t"`,
    ],
    json: [`["two",1]`, "[1]", `[1,"two",3]`, "null"],
    uses: [
      "$[0] + 1",
      "$[1].length",
      "$[1] + $[0]",
      "$.length",
      "$.join()",
      "JSON.stringify($)",
      "typeof $[0]",
      "const [count, label] = $;\nconsole.log(count + 1, label.length);",
      "const [count] = $;\nconsole.log(count * 2);",
      "const [, label] = $;\nconsole.log(label.toUpperCase());",
      "$[0] = 5;\nconsole.log($.join());",
      "for (const each of $) console.log(typeof each);",
    ],
  },
  letters: {
    type: `"a" | "b"`,
    plain: [`"a"`, `"b"`],
    fits: [`"ab"[0]`, `["b"].join("")`],
    other: [`"c"`, `""`, `"A"`, "1", "null", "undefined", `["a"]`, `new String("a")`, `"constructor"`, `"__proto__"`],
    json: [`"c"`, "1", "null", `["a"]`],
    uses: [
      `$ === "a" ? 1 : 2`,
      `$ === "a"`,
      `$ !== "b"`,
      "({ a: 1, b: 2 })[$]",
      "({ a: 1, b: 2 })[$] + 1",
      "({ a: () => 1, b: () => 2 })[$]()",
      "$.length",
      "$.toUpperCase()",
      "`${$}!`",
      "typeof $",
      `switch ($) {\ncase "a":\nconsole.log("first");\nbreak;\ncase "b":\nconsole.log("second");\nbreak;\n}\nconsole.log("behind");`,
      `switch ($) {\ncase "a":\nconsole.log("first");\nbreak;\ncase "b":\nconsole.log("second");\nbreak;\ndefault: {\nconst nothing‹: never› = $;\nconsole.log("neither", nothing);\n}\n}`,
      `if ($ === "a") console.log("first");\nelse console.log("second", $.length);`,
      `const table‹: Record<"a" | "b", number>› = { a: 1, b: 2 };\nconsole.log(table[$] + 1);`,
      `function told(letter‹: "a" | "b"›)‹: number› {\nswitch (letter) {\ncase "a":\nreturn 1;\ncase "b":\nreturn 2;\n}\n}\nconsole.log(told($));`,
    ],
  },
  either: {
    type: "number | string",
    plain: ["7", `"text"`],
    fits: ["2.5", `""`, "NaN"],
    other: [
      "true",
      "null",
      "undefined",
      "{}",
      "[1]",
      "7n",
      `Symbol("s")`,
      "{ length: 3 }",
      `new String("text")`,
      "() => 1",
    ],
    json: ["true", "null", "{}", "[1]"],
    uses: [
      `typeof $ === "number" ? $ + 1 : $.length`,
      `typeof $ === "string" ? $.length : $ + 1`,
      `typeof $ === "string" ? $.toUpperCase() : $.toFixed(1)`,
      `typeof $ !== "number" ? $.charAt(0) : $ * 2`,
      "typeof $",
      "`${$}`",
      "String($)",
      "$.toString()",
      "$ == 7",
      "JSON.stringify([$])",
      `if (typeof $ === "number") console.log($ + 1);\nelse console.log($.length);`,
      `switch (typeof $) {\ncase "number":\nconsole.log("a number");\nbreak;\ncase "string":\nconsole.log("a string");\nbreak;\ndefault:\nconsole.log("neither");\n}`,
    ],
  },
  nullable: {
    type: "number | null",
    plain: ["7", "null"],
    fits: ["-0", "2.5"],
    other: ["undefined", `"7"`, "false", "0n", "{}", `""`],
    json: [`"7"`, "false", "{}"],
    uses: [
      "$ === null ? -1 : $ + 1",
      "$ !== null ? $ * 2 : 0",
      "$ ?? 5",
      "($ ?? 5) + 1",
      "$ == null",
      "$ === null",
      "$?.toFixed(1)",
      "typeof $",
      "$ ? $ + 1 : 0",
      `if ($ === null) console.log("null");\nelse console.log($.toFixed(1));`,
      `if ($ != null) console.log($ + 1);\nelse console.log("nothing");`,
    ],
  },
  figures: {
    type: `{ kind: "circle"; r: number } | { kind: "square"; side: number }`,
    plain: [`{ kind: "circle", r: 2 }`, `{ kind: "square", side: 3 }`],
    fits: [`{ r: 2, kind: "circle" }`, `Object.freeze({ kind: "square", side: 3 })`],
    other: [
      `{ kind: "triangle", base: 2 }`,
      `{ kind: "circle", side: 3 }`,
      `{ kind: "square" }`,
      `{ kind: "circle", r: "2" }`,
      "{ r: 2 }",
      "{ kind: 1, r: 2 }",
      `{ kind: "circle", r: 2, side: 3 }`,
      `{ get kind() { return "circle"; }, r: 2 }`,
      `(turns => ({ get kind() { return turns++ ? "square" : "circle"; }, r: 2, side: 3 }))(0)`,
      "null",
      `"circle"`,
    ],
    json: [`{"kind":"triangle","base":2}`, `{"kind":"circle","side":3}`, `{"kind":"square"}`, "null"],
    uses: [
      `$.kind === "circle" ? $.r : $.side`,
      `$.kind === "circle" ? $.r * 2 : $.side + 1`,
      `$.kind === "square" ? $.side * $.side : $.r`,
      `$.kind !== "circle" ? $.side : $.r`,
      `"r" in $ ? $.r : $.side`,
      "$.kind",
      "$.kind.length",
      "Object.keys($).join()",
      "JSON.stringify($)",
      `switch ($.kind) {\ncase "circle":\nconsole.log($.r + 1);\nbreak;\ncase "square":\nconsole.log($.side + 1);\nbreak;\n}\nconsole.log("behind");`,
      `switch ($.kind) {\ncase "circle":\nconsole.log($.r);\nbreak;\ncase "square":\nconsole.log($.side);\nbreak;\ndefault: {\nconst nothing‹: never› = $;\nconsole.log("neither", typeof nothing);\n}\n}`,
      `if ($.kind === "circle") console.log($.r.toFixed(1));\nelse console.log($.side.toFixed(1));`,
    ],
  },
  color: {
    type: "Color",
    needs: "Color",
    plain: ["Color.Green", "0"],
    fits: ["Color.Blue", "2"],
    other: ["5", "-1", "1.5", `"Red"`, `"0"`, "null", "undefined", "NaN", "true", "Color"],
    json: ["5", `"Red"`, "null", "1.5"],
    uses: [
      "Color[$]",
      "$ === Color.Red",
      "$ === Color.Green ? 1 : 2",
      "$ + 1",
      "$ < Color.Blue",
      "typeof $",
      "`${$}`",
      "[10, 20, 30][$]",
      "Color[$]?.length",
      `switch ($) {\ncase Color.Red:\nconsole.log("red");\nbreak;\ncase Color.Green:\nconsole.log("green");\nbreak;\ncase Color.Blue:\nconsole.log("blue");\nbreak;\n}\nconsole.log("behind");`,
      `switch ($) {\ncase Color.Red:\nconsole.log("red");\nbreak;\ncase Color.Green:\nconsole.log("green");\nbreak;\ncase Color.Blue:\nconsole.log("blue");\nbreak;\ndefault: {\nconst nothing‹: never› = $;\nconsole.log("none", nothing);\n}\n}`,
      `const names‹: Record<Color, string>› = { [Color.Red]: "r", [Color.Green]: "g", [Color.Blue]: "b" };\nconsole.log(names[$]);`,
    ],
  },
  function: {
    type: "(n: number) => number",
    plain: ["n => n + 1", "function (n) { return n * 2; }"],
    fits: [
      "() => 5",
      "Math.abs",
      "n => n / 2",
      "n => -0",
      "(n => n + 1).bind(null)",
      "new Proxy(n => n + 1, {})",
      "function named(n) { return n; }",
    ],
    other: [
      "(a, b) => a + b",
      `() => "text"`,
      "n => String(n)",
      "() => undefined",
      "() => null",
      "n => [n]",
      "n => ({ n })",
      "n => BigInt(n)",
      "class { constructor(n) { this.n = n; } }",
      "async n => n + 1",
      "function* (n) { yield n; }",
      "function (n) { return this === undefined ? n : typeof this; }",
      "function () { return arguments.length; }",
      "(...all) => all.length",
      "n => { throw new RangeError(String(n)); }",
      "parseInt",
      "null",
      "undefined",
      "7",
      "{ call() { return 1; }, apply() { return 2; } }",
      "{}",
    ],
    json: ["null", "7", "{}"],
    uses: [
      "$(2)",
      "$(2) + 1",
      "$(2) * 2",
      "$(2.5)",
      "$(2).toFixed(1)",
      "typeof $(2)",
      "$(2) === 3",
      "$($(2))",
      "[1, 2, 3].map($).join()",
      "[1, 2, 3].map(each => $(each)).join()",
      "$.length",
      "$.name",
      "typeof $",
      "$.call(null, 2)",
      "$.apply(null, [2])",
      "$.bind(null, 2)()",
      `typeof $ === "function" ? $(1) : "no function"`,
      "$ instanceof Function",
      "let summed = 0;\nfor (let step = 0; step < 3; step++) summed += $(step);\nconsole.log(summed);",
      "const result = $(2);\nconsole.log(result + 1, typeof result);",
      "const holder = { run: $ };\nconsole.log(holder.run(2));",
    ],
  },
  record: {
    type: "{ [key: string]: number }",
    isObjectType: true,
    plain: ["{ a: 1, b: 2 }"],
    fits: ["{}", "{ a: 1.5 }", "Object.freeze({ a: 1 })", "{ 1: 1, a: 2 }", 'Object.fromEntries([["a", 1]])'],
    other: [
      `{ a: 1, b: "2" }`,
      `{ a: "1" }`,
      "{ a: null }",
      "{ a: undefined, b: 2 }",
      "Object.assign(Object.create(null), { a: 1 })",
      "Object.create({ a: 1 })",
      "[1, 2]",
      `new Map([["a", 1]])`,
      "new Proxy({}, { get: () => 5 })",
      `new Proxy({}, { get: (_, key) => key, has: () => true, ownKeys: () => ["z"], getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }) })`,
      "{ get a() { return 1; } }",
      "null",
      `"ab"`,
    ],
    json: [`{"a":1,"b":"2"}`, `{"a":null}`, "[1,2]", "null", `{"__proto__":1,"a":2}`],
    uses: [
      "$.a + 1",
      `$["a"] * 2`,
      "$.missing",
      "$.missing + 1",
      "$.constructor",
      "typeof $.toString",
      "Object.keys($).join()",
      "Object.values($).reduce((sum, each) => sum + each, 0)",
      "JSON.stringify($)",
      `"a" in $`,
      "Object.keys({ ...$ }).join()",
      "let summed = 0;\nfor (const key in $) summed += $[key];\nconsole.log(summed);",
      "for (const [key, value] of Object.entries($)) console.log(key, value + 1);",
      "$.c = 3;\nconsole.log(Object.keys($).join());",
      "$.a = 2.5;\nconsole.log($.a);",
      "delete $.a;\nconsole.log(Object.keys($).join());",
      `const key‹: string› = "a";\nconsole.log($[key]);`,
      `for (const key of ["a", "b", "c"]) console.log($[key]);`,
    ],
  },
  box: {
    type: "Box<number>",
    plain: ["{ value: 1 }"],
    fits: ["{ value: 1.5 }", "{ value: -0 }", "Object.freeze({ value: 1 })", "new (class { value = 1; })()"],
    other: [
      `{ value: "1" }`,
      "{}",
      "{ value: null }",
      "{ value: [1] }",
      "{ value: { value: 1 } }",
      '{ get value() { return "got"; } }',
      "Object.create({ value: 1 })",
      "null",
      "{ value: 1, more: 2 }",
    ],
    json: [`{"value":"1"}`, "{}", `{"value":null}`, "null"],
    uses: [
      "$.value + 1",
      "$.value * 2",
      "typeof $.value",
      "$.value.toFixed(1)",
      "JSON.stringify($)",
      "Object.keys($).join()",
      "const { value } = $;\nconsole.log(value + 1);",
      "$.value = 5;\nconsole.log($.value);",
      "$.value += 1;\nconsole.log($.value);",
      "function opened‹<T>›(box‹: Box<T>›)‹: T› {\nreturn box.value;\n}\nconsole.log(opened($) + 1);",
    ],
  },
};

const declarationsOf = {
  Shape: {
    path: "shape",
    text: `export class Shape {
  side: number;
  name: string = "shape";
  constructor(side: number) {
    this.side = side;
  }
  area(): number {
    return this.side * this.side;
  }
  get twice(): number {
    return this.side * 2;
  }
  static is(value: unknown): value is Shape {
    return value instanceof Shape;
  }
}
`,
  },
  Color: { path: "color", text: "export enum Color {\n  Red,\n  Green,\n  Blue,\n}\n" },
};

/** What makes a declaration file invalid and leaves what it exports as it is. `skipLibCheck` keeps the checker out of the file. */
const invalidDeclarations = [
  "export declare const unrelated: Missing;",
  "export declare function unrelated(value: Missing.Inner): NotThere<number>;",
  "export declare const twice: number;\nexport declare const twice: string;",
  "export interface Twice {\n  member: number;\n}\nexport interface Twice {\n  member: string;\n}",
  "export type Round = Around;\nexport type Around = Round;",
  "export declare class Below extends Below {}",
  "export interface Wide extends Narrow {\n  member: string;\n}\nexport interface Narrow {\n  member: number;\n}",
  "export declare class Sealed implements Promised {}\ninterface Promised {\n  kept(): void;\n}",
  "export declare function defaulted(value: number = 5): void;",
  "export declare const assigned: string = 5;",
  "export declare function overloaded(value: number): number;\nexport declare const overloaded: string;",
  "export type Argued = Array<number, string>;",
  "export type Keyed = { [key: boolean]: number };",
  'export declare enum Counted {\n  One = "one".length,\n  Two = Missing,\n}',
  "export declare const unique: unique symbol;\nexport declare let alsoUnique: unique symbol;",
  "export declare function guarded(value: number): other is string;",
  "export declare abstract class Half {\n  abstract member: number;\n}\nexport declare class Whole extends Half {}",
  "export declare namespace Inner {\n  const held: Absent;\n  export import Alias = Nowhere.Else;\n}",
  "export type Constrained<T extends string> = T;\nexport type Broken = Constrained<number>;",
  "export declare class Private {\n  private member: number;\n}\nexport declare class Public extends Private {\n  member: number;\n}",
  'declare module "./nowhere" {\n  export const added: number;\n}',
  'export type Indexed = { a: number }["b"];',
  "export declare const typed: typeof notDeclared;",
  "export declare function rested(...rest: number, last: string): void;",
  "export declare class Accessors {\n  get member(): number;\n  set member(value: string, more: number);\n}",
  'import type { Nothing } from "./not-a-file";\nexport declare const imported: Nothing;',
  'export { alsoMissing } from "./not-a-file";',
  'export * from "./not-a-file";',
];

/** Types that TypeScript reports where it checks, and then takes for `any`. `T` is the type that would be right. */
const invalidTypes: { type: string; declares?: string }[] = [
  { type: "Missing" },
  { type: "Missing.Inner" },
  { type: "NotThere<number>" },
  { type: "Missing<T>" },
  { type: "typeof notDeclared" },
  { type: `import("./not-a-file").Nothing` },
  { type: "Array<number, string>" },
  { type: "Promise" },
  { type: `{ a: number }["b"]` },
  { type: `Missing["member"]` },
  { type: "T | Missing" },
  { type: "Missing | T" },
  { type: "T & Missing" },
  { type: "Round", declares: "type Round = Around;\ntype Around = Round;" },
  { type: "Itself", declares: "type Itself = Itself;" },
  { type: "Argued<T>", declares: "type Argued = Missing;" },
];

type Typing = "TypeScript" | "a declaration file" | "JSDoc" | "inferred" | "none";

class Module {
  head: string[] = [];
  body: string[] = [];
  /** The lines of the declaration file beside it. */
  declared: string[] = [];
  declaredHead: string[] = [];
  constructor(
    public folder: string,
    public name: string,
    public end: string,
    public typing: Typing,
    /** The name under which a package is imported. */
    public bare?: string,
  ) {}
  get path() {
    return `${this.folder}${this.name}.${this.end}`;
  }
  get isTyped() {
    return this.typing === "TypeScript";
  }
  get isCommon() {
    return this.end === "cjs";
  }
  get declarationPath() {
    return `${this.folder}${this.name}.d.${{ mjs: "mts", cjs: "cts" }[this.end] ?? "ts"}`;
  }
  get text() {
    return [...this.head, ...this.body].join("\n") + "\n";
  }
}

export function generate(
  random: Random,
  corner: Corner = random.pick(corners),
  /** With `.cts` and `export * as`, which came later: without them a seed makes the program that it always made. */
  isWider = false,
): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const isStrict = random.chance(0.8);
  const isPackage = corner === "a package";
  const isAmbient = corner === "an ambient declaration";
  const ambient = isAmbient
    ? random.pick(["declare module", "declare module", "declare global", "declare const", "declare var"] as const)
    : undefined;
  const isGlobal = ambient !== undefined && ambient !== "declare module";
  const looseTyping: Typing = (
    {
      "a declaration file beside JavaScript": "a declaration file",
      "a declaration file that is invalid itself": "a declaration file",
      JSDoc: "JSDoc",
      "types inferred from JavaScript": "inferred",
      "JavaScript without types": "none",
      "a package": "a declaration file",
      "an ambient declaration": "none",
      "TypeScript hides it from TypeScript": "TypeScript",
      "TypeScript with a type that is invalid itself": "TypeScript",
      "JavaScript calls TypeScript": "none",
      "JavaScript alone": "none",
    } as const
  )[corner];
  const direction = isGlobal
    ? "global"
    : corner === "types inferred from JavaScript"
      ? random.pick(["set behind", "stored behind"] as const)
      : corner === "JavaScript calls TypeScript"
        ? random.weighted([
            [5, "argument"],
            [2, "constructor"],
            [2, "method"],
            [2, "field"],
            [1, "setter"],
            [2, "registered"],
          ] as const)
        : corner === "JavaScript without types" || isAmbient
          ? random.weighted([
              [4, "returned"],
              [2, "constant"],
              [2, "member"],
              [1, "awaited"],
              [2, "callback"],
            ] as const)
          : random.weighted([
              [5, "returned"],
              [2, "constant"],
              [2, "member"],
              [1, "awaited"],
              [3, "callback"],
              [4, "argument"],
              [1, "constructor"],
              [1, "method"],
              [1, "field"],
              [2, "registered"],
              [2, "joined"],
            ] as const);
  const goesIn = ["argument", "constructor", "method", "field", "setter"].includes(direction);

  // What TypeScript infers from a value as anybody would write it is the type for these.
  const kindName = random.pick(
    corner === "types inferred from JavaScript"
      ? ["number", "string", "boolean", "bigint", "pair", "list", "texts", "shape", "box"]
      : Object.keys(kinds),
  );
  const kind = kinds[kindName];
  const agreement = random.weighted([
    [6, "other"],
    [2, "fits"],
    [1, "plain"],
  ] as const);
  const turns = random.weighted([
    [6, "once"],
    [3, "a loop"],
    [1, "a loop with one odd turn"],
  ] as const);
  const guard = random.weighted([
    [5, "round the use"],
    [2, "round the call"],
    [3, "none"],
  ] as const);
  const keeping = random.weighted([
    [10, "nothing"],
    [1, "a variable"],
    [1, "a list"],
    [1, "a field"],
    [1, "a literal"],
    [1, "a closure"],
    [1, "a map"],
    [1, "a pattern"],
    [1, "a class with a parameter property"],
  ] as const);
  const naming = random.weighted([
    [5, "in place"],
    [3, "a name of its own"],
    [2, "a file of types"],
  ] as const);
  const invalid =
    corner === "TypeScript with a type that is invalid itself" ||
    (corner === "a declaration file that is invalid itself" && random.chance(0.6))
      ? random.pick(invalidTypes)
      : undefined;
  // One line is ignored where the type stands on one line, the whole file otherwise.
  const ignoresTheLine =
    !!invalid &&
    ["returned", "awaited", "joined", "constant", "member", "callback"].includes(direction) &&
    random.chance(0.6);
  const isHandedOn = random.chance(0.15);
  const hasCycle = random.chance(0.1);
  const between = random.weighted([
    [6, 0],
    [3, 1],
    [1, 2],
  ]);
  const isEnteredFromAnotherFile = random.chance(0.35);
  const checksJavaScript =
    corner === "JSDoc" ? random.chance(0.5) : corner === "types inferred from JavaScript" && random.chance(0.3);
  const hasProject = corner !== "JavaScript alone" || random.chance(0.5);
  const allowsJavaScript =
    corner === "JSDoc" ||
    corner === "types inferred from JavaScript" ||
    corner === "JavaScript alone" ||
    (corner !== "JavaScript without types" && !isGlobal && random.chance(0.15));
  // A file that waits for an import cannot be required.
  const late = random.pick(["require", "import()"] as const);
  const writesEnds = random.chance(0.5);

  const files: Record<string, string> = {};
  const modules: Module[] = [];
  const options: Record<string, unknown> = {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: isStrict,
    types: [],
    ...(allowsJavaScript && { allowJs: true }),
    ...(checksJavaScript && { checkJs: true }),
    ...(writesEnds && { allowImportingTsExtensions: true }),
    ...(corner === "a declaration file that is invalid itself"
      ? { skipLibCheck: true }
      : random.chance(0.2) && { skipLibCheck: true }),
  };

  const make = (name: string, typing: Typing, folder = "", bare?: string) => {
    const end =
      typing === "TypeScript"
        ? random.weighted([
            [8, "ts"],
            // A CommonJS file does not wait at its top.
            [isWider && late === "require" ? 1 : 0, "cts"],
            [1, "mts"],
            [1, "tsx"],
          ])
        : random.weighted([
            [6, "js"],
            [2, "mjs"],
            [late === "require" && (bare || typing === "none" || typing === "a declaration file") ? 2 : 0, "cjs"],
            [bare ? 0 : 1, "jsx"],
          ]);
    const module = new Module(folder, name, end, typing, bare);
    modules.push(module);
    return module;
  };
  const isChecked = (module: Module) => module.isTyped || (checksJavaScript && !module.folder);

  const specifier = (from: Module, to: Module) => {
    if (to.bare) return to.bare;
    const up = from.folder
      ? from.folder
          .split("/")
          .slice(0, -1)
          .map(() => "..")
          .join("/") + "/"
      : "./";
    if (!to.isTyped) return `${up}${to.path}`;
    // The real name where the project allows it or does not read the file that imports, and none otherwise.
    return writesEnds || from.folder || (!from.isTyped && !allowsJavaScript)
      ? `${up}${to.path}`
      : `${up}${to.folder}${to.name}${{ mts: ".mjs", cts: ".cjs" }[to.end] ?? ""}`;
  };

  /** Whether TypeScript knows nothing about the file from where it is imported. */
  const isUnknownTo = (from: Module, to: Module) =>
    isChecked(from) &&
    !to.isTyped &&
    to.typing !== "a declaration file" &&
    !(allowsJavaScript && !to.folder) &&
    !(to.bare && ambient === "declare module");

  let taken = 0;
  /** Writes the import of `name` into `from` and answers how the file names it. */
  function take(from: Module, to: Module, name: string, isType = false): string {
    const where = JSON.stringify(specifier(from, to));
    const ignore = isUnknownTo(from, to) && isStrict ? ["// @ts-ignore"] : [];
    if (isType) {
      from.head.push(`import type { ${name} } from ${where};`);
      return name;
    }
    if (from.isCommon) {
      const how = random.pick(["a pattern", "a member", "the whole"] as const);
      if (how === "a pattern") from.head.push(`const { ${name} } = require(${where});`);
      else if (how === "a member") from.head.push(`const ${name} = require(${where}).${name};`);
      else from.head.push(`const whole${++taken} = require(${where});`);
      return how === "the whole" ? `whole${taken}.${name}` : name;
    }
    const how = random.weighted([
      [6, "by name"],
      [2, "under another name"],
      [3, "the namespace"],
      [from.isTyped || late !== "require" ? 0 : 1, "require"],
      [isChecked(from) || allowsJavaScript || hasCycle || late !== "require" ? 0 : 1, "createRequire"],
      // Two files that wait for the import of one file go on in no steady order.
      [hasCycle || late !== "import()" || direction === "registered" ? 0 : 1, "import()"],
    ] as const);
    switch (how) {
      case "by name":
        from.head.push(...ignore, `import { ${name} } from ${where};`);
        return name;
      case "under another name":
        from.head.push(...ignore, `import { ${name} as taken${++taken} } from ${where};`);
        return `taken${taken}`;
      case "the namespace":
        from.head.push(...ignore, `import * as all${++taken} from ${where};`);
        return `all${taken}.${name}`;
      case "require":
        from.head.push(`const whole${++taken} = require(${where});`);
        return `whole${taken}.${name}`;
      case "createRequire":
        from.head.push(
          `import { createRequire } from "node:module";`,
          `const whole${++taken} = createRequire(import.meta.url)(${where});`,
        );
        return `whole${taken}.${name}`;
      case "import()":
        from.head.push(...ignore, `const later${++taken} = await import(${where});`);
        return `later${taken}.${name}`;
    }
  }

  // How each file writes the type.
  const typeText = kind.type;
  const isNamed = naming !== "in place" && !kind.needs;
  let typesFile: Module | undefined;
  const named = new Set<Module | string>();
  const boxDeclaration = "interface Box<T> {\n  value: T;\n}";
  function typeIn(module: Module, into: "head" | "declaredHead" = "head"): string {
    const key = into === "head" ? module : module.path + " declared";
    const lines = module[into];
    if (kind.needs) {
      if (!named.has(key)) {
        named.add(key);
        lines.push(
          `import ${kind.needs === "Shape" && into === "declaredHead" ? "type " : ""}{ ${kind.needs} } from ${JSON.stringify(specifier(into === "head" ? module : declaring, needed!))};`,
        );
      }
      return typeText;
    }
    const isBox = kindName === "box";
    if (!isNamed && !isBox) return typeText;
    if (named.has(key)) return isNamed ? "Given" : typeText;
    named.add(key);
    if (naming === "a file of types") {
      typesFile ??= (() => {
        const made = new Module("", "types", random.pick(["ts", "d.ts"]), "TypeScript");
        made.body.push(...(isBox ? ["export " + boxDeclaration] : []), `export type Given = ${typeText};`);
        modules.push(made);
        return made;
      })();
      const where = JSON.stringify(
        module.folder ? "../../types" : typesFile.end === "ts" && writesEnds ? "./types.ts" : "./types",
      );
      lines.push(`import type { Given${isBox && /Box</.test(usesText) ? ", Box" : ""} } from ${where};`);
      return "Given";
    }
    if (isBox) lines.push(boxDeclaration);
    if (!isNamed) return typeText;
    lines.push(kind.isObjectType && random.chance(0.5) ? `interface Given ${typeText}` : `type Given = ${typeText};`);
    return "Given";
  }
  /** Stands in for a module where a declaration file writes its imports: TypeScript, in the same folder. */
  const declaring = new Module("", "declaring", "ts", "TypeScript");

  const use = random.pick(kind.uses);
  const usesText = use;
  const isExpression = !use.includes("console.log");
  const needed = kind.needs ? new Module("", declarationsOf[kind.needs].path, "ts", "TypeScript") : undefined;
  if (needed) {
    needed.body.push(declarationsOf[kind.needs!].text.trimEnd());
    modules.push(needed);
  }

  let value = random.pick(kind[agreement]);
  const plain = random.pick(kind.plain);
  const disagrees = agreement === "other";

  // The two files.
  const packageName = random.pick(["made", "@scope/made"]);
  const packageFolder = `node_modules/${packageName}/`;
  const inPackage = isPackage || ambient === "declare module";
  // Where the value goes into a function, the file with the declared type is the one that uses it.
  const userIsLoose = goesIn && looseTyping !== "TypeScript" && corner !== "JavaScript calls TypeScript";
  const userTyping: Typing = corner === "JavaScript alone" ? "none" : userIsLoose ? looseTyping : "TypeScript";
  const makerTyping: Typing =
    corner === "JavaScript alone" ? "none" : userIsLoose ? random.pick(["TypeScript", "none"] as const) : looseTyping;
  const user = make(
    "user",
    userTyping,
    userIsLoose && inPackage ? packageFolder : "",
    userIsLoose && inPackage ? packageName : undefined,
  );
  const maker = make(
    "maker",
    makerTyping,
    !userIsLoose && inPackage ? packageFolder : "",
    !userIsLoose && inPackage ? packageName : undefined,
  );
  if (maker.isCommon && user.isCommon) user.end = "js";

  /** TypeScript knows nothing about what the maker exports: the user writes the type. */
  const makerIsUnknown = ((maker.typing === "none" && ambient !== "declare module") || !!invalid) && user.isTyped;
  const written = (text: string, module: Module) => text.replace(/‹([^›]*)›/g, module.isTyped ? "$1" : "");
  const mentions = (text: string, module: Module) => {
    if (kind.needs && new RegExp(`\\b${kind.needs}\\b`).test(text) && !named.has(module)) {
      named.add(module);
      if (module.isCommon)
        module.head.push(`const { ${kind.needs} } = require(${JSON.stringify(specifier(module, needed!))});`);
      else module.head.push(`import { ${kind.needs} } from ${JSON.stringify(specifier(module, needed!))};`);
    }
    return text;
  };

  // What hides the disagreement where a checker looks.
  const isPlainlyOther =
    !invalid && disagrees && (primitivesOfOtherKinds.test(value) || (isStrict && /^(?:null|undefined)$/.test(value)));
  function hidden(module: Module, type: string, write: (text: string) => string, text = value): string[] {
    mentions(text, module);
    if (invalid) type = "any";
    if (!isChecked(module)) return [write(text)];
    // A value that TypeScript does not accept as it stands, whatever it is assigned to.
    const isRefusedItself =
      kindName === "function" ||
      /=> \(delete|return arguments|get side\(\)|extends Array|new Shape\((?:"3"|null)?\)/.test(text);
    if (!module.isTyped) {
      const how = random.weighted([
        [2, "@ts-ignore"],
        [2, "@ts-nocheck"],
        [isPlainlyOther && text === value && type !== "any" ? 1 : 0, "@ts-expect-error"],
        [isRefusedItself ? 0 : 2, "a cast in a comment"],
      ] as const);
      if (how === "@ts-nocheck") {
        if (module.head[0] !== "// @ts-nocheck") module.head.unshift("// @ts-nocheck");
        return [write(text)];
      }
      return how === "a cast in a comment" ? [write(`/** @type {any} */ (${text})`)] : [`// ${how}`, write(text)];
    }
    const how = random.weighted([
      [isRefusedItself ? 0 : 3, "as any"],
      [isRefusedItself ? 0 : 3, "as unknown as T"],
      [isRefusedItself ? 0 : 2, "a variable of type any"],
      [2, "@ts-ignore"],
      [isPlainlyOther && text === value && type !== "any" ? 2 : 0, "@ts-expect-error"],
      [2, "@ts-nocheck"],
      [text === value ? 2 : 0, "JSON.parse"],
      [isRefusedItself ? 0 : 1, "a map"],
      [isRefusedItself ? 0 : 1, "Reflect.get"],
      [isRefusedItself ? 0 : 1, "a generic cast"],
      [/^(?:null|undefined)$/.test(text) ? 4 : 0, "!"],
    ] as const);
    switch (how) {
      case "as any":
        return [write(`(${text}) as any`)];
      case "as unknown as T":
        return [write(`(${text}) as unknown as ${type}`)];
      case "a variable of type any":
        return [`const loose: any = ${text};`, write("loose")];
      case "@ts-ignore":
      case "@ts-expect-error":
        return [`// ${how}`, write(text)];
      case "@ts-nocheck":
        if (module.head[0] !== "// @ts-nocheck") module.head.unshift("// @ts-nocheck");
        return [write(text)];
      case "JSON.parse":
        value = `JSON.parse(${JSON.stringify(random.pick(kind.json))})`;
        return [write(value)];
      case "a map":
        return [write(`new Map<any, any>([["key", ${text}]]).get("key")`)];
      case "Reflect.get":
        return [write(`Reflect.get({ key: ${text} } as object, "key")`)];
      case "a generic cast":
        module.body.unshift("function cast<T>(value: unknown): T {\n  return value as T;\n}");
        return [write(`cast<${type}>(${text})`)];
      case "!":
        return [`const maybe = [${text}][0] as ${type} | null | undefined;`, write("maybe!")];
    }
  }

  const caught = [
    "} catch (error) {",
    `console.log("THROWS", error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : typeof error);`,
    "}",
  ];
  const guarded = (lines: string[], _module: Module) => ["try {", ...lines, ...caught];
  const inLoop = (lines: string[]) => [
    "for (let turn = 0; turn < 10000; turn++) {",
    ...lines.map(line => line.replace(/\bconsole\.log\(/, "turn === 9999 && console.log(")),
    "}",
  ];

  /** The lines that keep `x` as drawn and use it, in `module`, where its type is written `type`. */
  function scene(module: Module, x: string, type: string, answers: boolean, isOfNoType = false): string[] {
    const of = (annotation: string) => (module.isTyped ? annotation : "");
    if (kindName === "box" && module.isTyped) typeIn(module);
    let lines: string[] = [];
    let held = x;
    // Where JavaScript is checked, what it keeps has the type that is inferred.
    switch (
      !module.isTyped && isChecked(module) && keeping !== "a pattern" && keeping !== "a closure" ? "nothing" : keeping
    ) {
      case "a variable":
        lines = [`let later${of(`: ${type}`)};`, `later = ${x};`];
        held = "later";
        break;
      case "a list":
        lines = [`const kept${of(`: ${type.includes(" ") ? `(${type})` : type}[]`)} = [];`, `kept.push(${x});`];
        held = "kept[0]";
        break;
      case "a field":
        lines = [
          `class Keeper {\nheld${of(`: ${type}`)};\nconstructor(held${of(`: ${type}`)}) {\nthis.held = held;\n}\n}`,
          `const keeper = new Keeper(${x});`,
        ];
        held = "keeper.held";
        break;
      case "a class with a parameter property":
        if (!module.isTyped) break;
        lines = [`class Keeper {\nconstructor(public held: ${type}) {}\n}`, `const keeper = new Keeper(${x});`];
        held = "keeper.held";
        break;
      case "a literal":
        lines = [`const holding${of(`: { held: ${type} }`)} = { held: ${x} };`];
        held = "holding.held";
        break;
      case "a closure":
        if (/\bawait\b/.test(x)) break;
        lines = [`const read = ()${of(`: ${type}`)} => ${x};`];
        held = "read()";
        break;
      case "a map":
        lines = [`const kept = new Map${of(`<string, ${type}>`)}([["key", ${x}]]);`];
        held = `kept.get("key")${of("!")}`;
        break;
      case "a pattern":
        lines = [`const [again] = [${x}];`];
        held = "again";
        break;
    }
    // A use that names the value more than once, or stores into it, names a variable.
    const times = use.match(/\$(?!\{)/g)!.length;
    if (
      isOfNoType ||
      (held !== x
        ? /[()]/.test(held) && times > 1
        : /^(?:all|later|whole)\d/.test(x)
          ? times > 1
          : /[()]/.test(x) && (times > 1 || random.chance(0.5)))
    ) {
      lines.push(`const it${isOfNoType || random.chance(0.3) ? of(`: ${type}`) : ""} = ${held};`);
      held = "it";
    }
    // A use with a function or a cast of its own is another one where the types are left out.
    if (!module.isTyped && isChecked(module) && /\(\w+‹:|‹ as /.test(use) && module.head[0] !== "// @ts-nocheck")
      module.head.unshift("// @ts-nocheck");
    const text = mentions(written(use, module), module).replace(/\$(?!\{)/g, () => held);
    if (isExpression) lines.push(answers ? `return ${text};` : `console.log(${text});`);
    else lines.push(...text.split("\n"));
    // A use that prints stands in the loop itself, and says something on the last turn alone.
    return loops && !isExpression ? inLoop(lines) : lines;
  }

  /** Writes a function into a file, with its types as the file has them. */
  function declareFunction(
    module: Module,
    name: string,
    parameters: [string, string][],
    returns: string,
    body: string[],
    isAsync = false,
  ) {
    const list = parameters
      .map(([parameter, type]) => (module.isTyped ? `${parameter}: ${type}` : parameter))
      .join(", ");
    const result = module.isTyped && returns ? `: ${isAsync ? `Promise<${returns}>` : returns}` : "";
    if (module.typing === "JSDoc")
      module.body.push(
        [
          "/**",
          ...parameters.map(([parameter, type]) => ` * @param {${type}} ${parameter}`),
          ...(returns ? [` * @returns {${isAsync ? `Promise<${returns}>` : returns}}`] : []),
          " */",
        ].join("\n"),
      );
    else if (!module.isTyped && isChecked(module) && parameters.length)
      module.body.push(`/** ${parameters.map(([parameter]) => `@param {any} ${parameter}`).join(" ")} */`);
    const head = `${isAsync ? "async " : ""}function ${name}(${list})${result} {`;
    if (module.isCommon)
      module.body.push(
        random.chance(0.5) ? `exports.${name} = ${head}` : `module.exports.${name} = ${head}`,
        ...body,
        "};",
      );
    else
      module.body.push(...(module.isTyped && ignoresTheLine ? ["// @ts-ignore"] : []), `export ${head}`, ...body, "}");
    if (module.typing === "a declaration file")
      module.declared.push(
        `export declare function ${name}(${parameters.map(([parameter, type]) => `${parameter}: ${type}`).join(", ")}): ${returns ? (isAsync ? `Promise<${returns}>` : returns) : "void"};`,
      );
  }
  function declareConstant(module: Module, name: string, type: string, lines: string[]) {
    if (module.typing === "JSDoc") module.body.push(`/** @type {${type}} */`);
    module.body.push(...lines.slice(0, -1));
    if (module.isTyped && ignoresTheLine && lines.at(-2) !== "// @ts-ignore") module.body.push("// @ts-ignore");
    module.body.push(lines.at(-1)!);
    if (module.typing === "a declaration file") module.declared.push(`export declare const ${name}: ${type};`);
  }
  /** How the type is written where the file's types stand: in the file, or in the declaration file beside it. */
  const borderType = (module: Module) => {
    const right = rightBorderType(module);
    if (!invalid || (module.typing !== "a declaration file" && !module.isTyped)) return right;
    if (invalid.declares) module[module.isTyped ? "head" : "declaredHead"].push(invalid.declares);
    if (module.isTyped && (invalid.declares || !ignoresTheLine) && module.head[0] !== "// @ts-nocheck")
      module.head.unshift("// @ts-nocheck");
    return (writtenInvalid = invalid.type.replace(/\bT\b/, () => (right.includes(" ") ? `(${right})` : right)));
  };
  let writtenInvalid = "";
  const rightBorderType = (module: Module) =>
    module.typing === "a declaration file"
      ? typeIn(module, "declaredHead")
      : module.typing === "JSDoc"
        ? kind.needs
          ? `import(${JSON.stringify(specifier(module, needed!))}).${kind.needs}`
          : typeText.replace("Box<number>", "{ value: number }")
        : module.isTyped
          ? typeIn(module)
          : typeText;
  const exported = (module: Module, name: string, text: string, annotation = "") =>
    module.isCommon ? `exports.${name} = ${text};` : `export const ${name}${annotation} = ${text};`;

  /** Files between: each exports again what the one before it exports, or hands it on by a function. */
  /** What stands behind the name that `through` answers, where a file between exports a namespace. */
  let deeper = "";
  function through(
    from: Module,
    to: Module,
    name: string,
    signature?: { parameters: [string, string][]; returns: string },
  ): [Module, string] {
    let [target, exportedAs] = [to, name];
    deeper = "";
    for (let id = 0; id < between; id++) {
      // TypeScript sees through a file between that is TypeScript. One of JavaScript stands where nobody checks, or where JavaScript is read.
      const mayBeLoose = !isChecked(from) || allowsJavaScript;
      const link = make(
        `between${id + 1}`,
        corner === "JavaScript alone" || (mayBeLoose && random.chance(0.5)) ? "none" : "TypeScript",
      );
      if (link.isCommon || link.end === "jsx") link.end = "js";
      const where = JSON.stringify(specifier(link, target));
      const ignore = isUnknownTo(link, target) && isStrict ? ["// @ts-ignore"] : [];
      const how = random.weighted([
        [3, "export {}"],
        [isUnknownTo(link, target) ? 0 : 3, "export *"],
        [2, "an import exported"],
        [2, "under another name"],
        [isWider ? 2 : 0, "export * as"],
        [signature ? 4 : 0, "a function"],
      ] as const);
      if (how === "export {}") link.body.push(...ignore, `export { ${exportedAs} } from ${where};`);
      else if (how === "export *") link.body.push(...ignore, `export * from ${where};`);
      else if (how === "an import exported")
        link.body.push(...ignore, `import { ${exportedAs} } from ${where};`, `export { ${exportedAs} };`);
      else if (how === "export * as") {
        link.body.push(...ignore, `export * as inner${id} from ${where};`);
        deeper = `.${exportedAs}${deeper}`;
        exportedAs = `inner${id}`;
      } else if (how === "under another name") {
        link.body.push(...ignore, `export { ${exportedAs} as handed${id} } from ${where};`);
        exportedAs = `handed${id}`;
      } else {
        const inner = take(link, target, exportedAs) + deeper;
        deeper = "";
        const typed = random.pick(["the type", "any", "generic"] as const);
        const { parameters, returns } = signature!;
        // Each file writes the type in its own way.
        const type = (text: string) =>
          typed === "any"
            ? "any"
            : writtenInvalid && text.includes(writtenInvalid)
              ? text.slice(0, text.lastIndexOf(writtenInvalid)) +
                typeIn(link) +
                text.slice(text.lastIndexOf(writtenInvalid) + writtenInvalid.length)
              : text.includes("Given")
                ? text.replace("Given", () => typeIn(link))
                : text.includes(typeText)
                  ? text.replace(typeText, () => typeIn(link))
                  : text;
        const list = parameters
          .map(([parameter, text]) => (link.isTyped ? `${parameter}: ${type(text)}` : parameter))
          .join(", ");
        const result = link.isTyped && returns ? `: ${type(returns)}` : "";
        if (!link.isTyped && isChecked(link) && parameters.length)
          link.body.push(`/** ${parameters.map(([parameter]) => `@param {any} ${parameter}`).join(" ")} */`);
        link.body.push(
          `export function pass${id}(${list})${result} {`,
          `return ${inner}(${parameters.map(([parameter]) => parameter).join(", ")});`,
          "}",
        );
        exportedAs = `pass${id}`;
      }
      target = link;
    }
    return [target, exportedAs];
  }

  const loops = turns !== "once";
  // Only a use that answers stands in a loop round the call.
  const hasOddTurn = turns === "a loop with one odd turn" && isExpression;
  const oddTurn = (text: string) => (hasOddTurn ? `turn === 9999 ? ${text} : ${plain}` : text);
  let entry: Module;
  let startLines: string[] = [];

  /** Where the value is used at last: in the user's file, or in one more file that the user hands it to. */
  function useIn(module: Module, x: string, answers: boolean, isOfNoType = false): string[] {
    if (!isHandedOn) return scene(module, x, module.isTyped ? typeIn(module) : typeText, answers, isOfNoType);
    const last = make(
      "last",
      module.isTyped && !random.chance(0.3)
        ? "TypeScript"
        : allowsJavaScript || !isChecked(module)
          ? "none"
          : "TypeScript",
    );
    if (last.isCommon) last.end = "js";
    declareFunction(
      last,
      "finish",
      [["given", last.isTyped ? typeIn(last) : typeText]],
      "",
      scene(last, "given", last.isTyped ? typeIn(last) : typeText, isExpression),
    );
    const finish = take(module, last, "finish");
    return isExpression
      ? [answers ? `return ${finish}(${x});` : `console.log(${finish}(${x}));`]
      : [`${finish}(${x});`];
  }

  const wrapped = (lines: string[], module: Module, isLooped: boolean) => {
    const looped = isLooped && isExpression ? inLoop(lines) : lines;
    return guard === "none" ? looped : guarded(looped, module);
  };

  switch (direction) {
    case "returned":
    case "awaited":
    case "joined": {
      const isAsync = direction === "awaited";
      const type = borderType(maker);
      declareFunction(
        maker,
        "make",
        hasOddTurn ? [["turn", "number"]] : [],
        type,
        hidden(maker, type, text => `return ${text};`, oddTurn(value)),
        isAsync,
      );
      const argument = hasOddTurn ? "turn" : "";
      if (direction === "joined") {
        const own = user.isTyped ? typeIn(user) : typeText;
        declareFunction(
          user,
          "use",
          [["x", own]],
          "",
          guard === "round the use" ? guarded(useIn(user, "x", isExpression), user) : useIn(user, "x", isExpression),
        );
        entry = make("main", random.chance(0.6) && corner !== "JavaScript alone" ? "TypeScript" : "none");
        if (entry.isCommon) entry.end = "js";
        const [from, name] = through(entry, maker, "make", {
          parameters: argument ? [["turn", "number"]] : [],
          returns: type,
        });
        const makes = take(entry, from, name) + deeper;
        const uses = take(entry, user, "use");
        const call = `${uses}(${makes}(${argument}))`;
        const line = isExpression ? `console.log(${call});` : `${call};`;
        // A use that prints says so on every turn, so only one that answers stands in a loop of the first file.
        const lines = loops && isExpression ? inLoop([line]) : [argument ? line.replace("(turn)", "(9999)") : line];
        entry.body.push(...(guard === "round the call" ? guarded(lines, entry) : lines));
        break;
      }
      const [from, name] = through(user, maker, "make", {
        parameters: argument ? [["turn", "number"]] : [],
        returns: isAsync ? `Promise<${type}>` : type,
      });
      const makes = take(user, from, name) + deeper;
      const call = `${isAsync ? "await " : ""}${makes}(${argument})`;
      const lines = useIn(user, isAsync ? `(${call})` : call, false, makerIsUnknown);
      startLines = wrapped(lines, user, loops);
      if (!loops && argument) startLines = startLines.map(line => line.replace("(turn)", "(9999)"));
      entry = user;
      break;
    }
    case "constant":
    case "member": {
      const type = borderType(maker);
      const isMember = direction === "member";
      const whole = isMember ? `{ held: ${type} }` : type;
      const annotation = maker.isTyped ? `: ${whole}` : "";
      const lines = hidden(
        maker,
        whole,
        text => exported(maker, "given", text, annotation),
        isMember ? `{ held: ${value} }` : value,
      );
      declareConstant(maker, "given", whole, lines);
      const [from, name] = through(user, maker, "given");
      const given = take(user, from, name) + deeper + (isMember ? ".held" : "");
      startLines = wrapped(useIn(user, given, false, makerIsUnknown), user, loops);
      entry = user;
      break;
    }
    case "callback":
    case "registered": {
      const type = borderType(maker);
      const own = user.isTyped ? typeIn(user) : typeText;
      const body = guard === "round the use" ? guarded(useIn(user, "x", false), user) : useIn(user, "x", false);
      // A use that prints is called once: the loop stands inside the callback.
      const callback = [
        `(x${user.isTyped && (direction === "registered" || random.chance(0.6) || maker.typing === "none" || between > 0 || invalid) ? `: ${own}` : ""}) => {`,
        ...(loops && isExpression ? inLoop(body) : body),
        "}",
      ];
      const more = isChecked(maker) ? "" : random.pick(["", "", ", 1", `, "more"`]);
      if (direction === "callback") {
        declareFunction(
          maker,
          "each",
          [["callback", `(x: ${type}) => void`]],
          "",
          hidden(maker, type, text => `callback(${text}${more});`),
        );
        const [from, name] = through(user, maker, "each", {
          parameters: [["callback", `(x: ${type}) => void`]],
          returns: "",
        });
        const each = take(user, from, name) + deeper;
        const lines = [`${each}(${callback[0]}`, ...callback.slice(1, -1), "});"];
        startLines = guard === "round the call" ? guarded(lines, user) : lines;
        entry = user;
        break;
      }
      const registry = make("registry", random.chance(0.5) && corner !== "JavaScript alone" ? "TypeScript" : "none");
      if (registry.isCommon || registry.end === "jsx") registry.end = "js";
      const handler = registry.isTyped
        ? random.pick([`(x: ${typeIn(registry)}) => void`, "(x: any) => void", "Function"])
        : "";
      if (!registry.isTyped && isChecked(registry)) registry.head.push("// @ts-nocheck");
      registry.body.push(
        `const handlers${registry.isTyped ? `: (${handler})[]` : ""} = [];`,
        `export function on(handler${registry.isTyped ? `: ${handler}` : ""}) {`,
        "handlers.push(handler);",
        "}",
        `export function fire(value${registry.isTyped ? ": any" : ""}) {`,
        "for (const handler of handlers) handler(value);",
        "}",
      );
      user.body.push(`${take(user, registry, "on")}(${callback[0]}`, ...callback.slice(1, -1), "});");
      const fire = take(maker, registry, "fire");
      const fires = hidden(maker, "any", text => `${fire}(${text});`);
      maker.body.push(...(guard === "round the call" ? guarded(fires, maker) : fires));
      entry = make("main", random.chance(0.5) && corner !== "JavaScript alone" ? "TypeScript" : "none");
      if (entry.isCommon) entry.end = "js";
      for (const each of [user, maker])
        entry.head.push(
          ...(isUnknownTo(entry, each) && isStrict ? ["// @ts-ignore"] : []),
          `import ${JSON.stringify(specifier(entry, each))};`,
        );
      break;
    }
    case "argument":
    case "constructor":
    case "method":
    case "setter":
    case "field": {
      const type = borderType(user);
      const inner = guard === "round the use" ? (lines: string[]) => guarded(lines, user) : (lines: string[]) => lines;
      let target = "use";
      if (direction === "argument") {
        const form =
          user.isTyped && kind.isObjectType && kindName === "pair" && random.chance(0.3)
            ? "a pattern"
            : random.chance(0.1)
              ? "a rest"
              : random.chance(0.1)
                ? "a default"
                : "a name";
        if (form === "a pattern" && /^\$\.[ab]\b/.test(use) && isExpression) {
          user.body.push(
            `export function use({ a, b }: ${type}) {`,
            ...inner([`return ${written(use, user).replace(/\$\./g, "")};`]),
            "}",
          );
        } else if (form === "a rest" && user.isTyped) {
          user.body.push(
            `export function use(...all: ${type.includes(" ") ? `(${type})` : type}[]) {`,
            ...inner(useIn(user, "all[0]", isExpression)),
            "}",
          );
        } else if (form === "a default" && user.isTyped) {
          user.body.push(
            `export function use(x: ${type} = ${mentions(plain, user)}) {`,
            ...inner(useIn(user, "x", isExpression)),
            "}",
          );
        } else declareFunction(user, "use", [["x", type]], "", inner(useIn(user, "x", isExpression)));
      } else {
        // A class of the user's: the value arrives through its constructor, a method, a setter or a store to its field.
        target = "Holder";
        const of = (annotation: string) => (user.isTyped ? annotation : "");
        const doc = (text: string) => (user.typing === "JSDoc" ? [`/** ${text} */`] : []);
        const show = ["show() {", ...inner(useIn(user, "this.held", isExpression)), "}"];
        const first = mentions(plain, user);
        const members =
          direction === "constructor"
            ? [
                ...doc(`@type {${type}}`),
                `held${of(`: ${type}`)};`,
                ...doc(`@param {${type}} held`),
                `constructor(held${of(`: ${type}`)}) {`,
                "this.held = held;",
                "}",
              ]
            : direction === "method"
              ? [
                  ...doc(`@type {${type}}`),
                  `held${of(`: ${type}`)} = ${first};`,
                  ...doc(`@param {${type}} held`),
                  `take(held${of(`: ${type}`)}) {`,
                  "this.held = held;",
                  "}",
                ]
              : direction === "setter"
                ? [
                    `#held${of(`: ${type}`)} = ${first};`,
                    "get held() {",
                    "return this.#held;",
                    "}",
                    `set held(value${of(`: ${type}`)}) {`,
                    "this.#held = value;",
                    "}",
                  ]
                : [...doc(`@type {${type}}`), `held${of(`: ${type}`)} = ${first};`];
        user.body.push(
          `${user.isCommon ? "exports.Holder = " : "export "}class Holder {`,
          ...members,
          ...show,
          user.isCommon ? "};" : "}",
        );
        if (user.typing === "a declaration file")
          user.declared.push(
            `export declare class Holder {\n  held: ${type};\n  constructor(${direction === "constructor" ? `held: ${type}` : ""});\n${direction === "method" ? `  take(held: ${type}): void;\n` : ""}  show(): unknown;\n}`,
          );
      }
      const [from, name] =
        direction === "argument"
          ? through(maker, user, target, { parameters: [["x", type]], returns: "" })
          : through(maker, user, target);
      const reached = take(maker, from, name) + deeper;
      const said = maker.isTyped ? typeIn(maker) : typeText;
      const print = (text: string) => (isExpression ? `console.log(${text});` : `${text};`);
      let lines: string[];
      if (direction === "argument")
        lines = hidden(
          maker,
          said,
          text => print(`${reached}(${text})`),
          loops && isExpression ? oddTurn(value) : value,
        );
      else if (direction === "constructor")
        lines = hidden(
          maker,
          said,
          text => print(`new ${reached}(${text}).show()`),
          loops && isExpression ? oddTurn(value) : value,
        );
      else {
        const stores =
          direction === "method"
            ? (text: string) => `holder.take(${text});`
            : (text: string) => `holder.held = ${text};`;
        lines = [`const holder = new ${reached}();`, ...hidden(maker, said, stores), print("holder.show()")];
      }
      const looped = loops && isExpression ? inLoop(lines) : lines;
      startLines = guard === "round the call" ? guarded(looped, maker) : looped;
      entry = maker;
      break;
    }
    case "set behind":
    case "stored behind": {
      // TypeScript infers the type from what the file of JavaScript writes. Another file of JavaScript then puts something else there.
      const setter = make("setter", "none");
      if (setter.isCommon) setter.end = "js";
      if (maker.isCommon) maker.end = "js";
      mentions(plain, maker);
      if (direction === "set behind") {
        maker.body.push(
          `let held = ${plain};`,
          ...(checksJavaScript ? ["/** @param {any} value */"] : []),
          "export function set(value) {",
          "held = value;",
          "}",
          "export function make() {",
          "return held;",
          "}",
        );
        setter.body.push(...hidden(setter, "any", text => `${take(setter, maker, "set")}(${text});`));
      } else {
        maker.body.push(`export const holder = { held: ${plain} };`);
        setter.body.push(...hidden(setter, typeText, text => `${take(setter, maker, "holder")}.held = ${text};`));
      }
      user.head.push(`import ${JSON.stringify(specifier(user, setter))};`);
      const [from, name] = through(user, maker, direction === "set behind" ? "make" : "holder");
      const reached = take(user, from, name) + deeper;
      startLines = wrapped(
        useIn(user, direction === "set behind" ? `${reached}()` : `${reached}.held`, false),
        user,
        loops,
      );
      entry = user;
      break;
    }
    case "global": {
      if (maker.isCommon) maker.end = "js";
      maker.body.push(`globalThis.given = ${mentions(value, maker)};`);
      const type = typeText;
      const isBox = kindName === "box";
      let isOnTheGlobal = ambient === "declare global";
      if (ambient === "declare global") {
        user.head.push(...(isBox ? [boxDeclaration] : []));
        mentions(type, user);
        user.body.push("declare global {", `  var given: ${type};`, "}");
      } else {
        const inFile = !kind.needs && random.chance(0.6);
        const line = `declare ${ambient === "declare const" ? "const" : "var"} given: ${type};`;
        isOnTheGlobal = inFile && ambient === "declare var";
        if (inFile) files["globals.d.ts"] = `${isBox ? boxDeclaration + "\n" : ""}${line}\n`;
        else {
          user.head.push(...(isBox ? [boxDeclaration] : []));
          mentions(type, user);
          user.body.push(line);
        }
      }
      named.add(user);
      user.head.push(
        ...(isUnknownTo(user, maker) && isStrict ? ["// @ts-ignore"] : []),
        `import ${JSON.stringify(specifier(user, maker))};`,
      );
      startLines = wrapped(
        scene(user, random.chance(0.3) && isOnTheGlobal ? "globalThis.given" : "given", type, false),
        user,
        loops,
      );
      entry = user;
      break;
    }
  }

  // The first file: the one that begins, or one more that calls it.
  if (startLines.length) {
    const usesAwait = startLines.some(line => /\bawait\b/.test(line));
    if (isEnteredFromAnotherFile && !entry.bare) {
      const begun = entry;
      if (begun.isCommon) begun.body.push("exports.run = function run() {", ...startLines, "};");
      else begun.body.push(`export ${usesAwait ? "async " : ""}function run() {`, ...startLines, "}");
      if (begun.typing === "a declaration file")
        begun.declared.push(`export declare function run(): ${usesAwait ? "Promise<void>" : "void"};`);
      entry = make("main", random.chance(0.5) && corner !== "JavaScript alone" ? "TypeScript" : "none");
      if (entry.isCommon) entry.end = "js";
      entry.body.push(`${usesAwait ? "await " : ""}${take(entry, begun, "run")}();`);
    } else entry.body.push(...startLines);
  }
  // A cycle: the file that is imported needs a function of the file that imports it.
  if (
    hasCycle &&
    !maker.bare &&
    !user.bare &&
    !maker.isCommon &&
    !user.isCommon &&
    direction !== "registered" &&
    direction !== "joined"
  ) {
    const [importer, imported] = goesIn ? [maker, user] : [user, maker];
    importer.body.push(`export function told() {\nreturn "told";\n}`);
    if (importer.typing === "a declaration file") importer.declared.push("export declare function told(): string;");
    imported.head.push(
      ...(isUnknownTo(imported, importer) && isStrict ? ["// @ts-ignore"] : []),
      `import { told } from ${JSON.stringify(specifier(imported, importer))};`,
    );
    imported.body.push(`export const alsoTold = () => told();`);
    if (imported.typing === "a declaration file")
      imported.declared.push("export declare const alsoTold: () => string;");
  }

  // The declarations.
  for (const module of modules) {
    // A file that waits, and one that is named a module, says that it is a module.
    if (
      (module.end === "mjs" || /^(?:const \w+ = )?await /m.test(module.text)) &&
      !/^(?:import|export) /m.test(module.text)
    )
      module.body.push("export {};");
    files[module.path] = module.text;
    if (module.typing !== "a declaration file" || module.bare) continue;
    const more =
      corner === "a declaration file that is invalid itself"
        ? random.sample(invalidDeclarations, random.between(1, 3))
        : [];
    const at = random.below(2);
    files[module.declarationPath] =
      [...module.declaredHead, ...(at ? [] : more), ...module.declared, ...(at ? more : [])].join("\n") + "\n";
  }
  const inside = modules.find(module => module.bare);
  if (inside) {
    const main = `${inside.name}.${inside.end}`;
    const declarations =
      [
        ...inside.declaredHead.map(line =>
          line
            .replace(/"\.\/(shape|color)(\.ts)?"/, `"../../${packageName.includes("/") ? "../" : ""}$1$2"`)
            .replace(`"../../types"`, `"../../${packageName.includes("/") ? "../" : ""}types"`),
        ),
        ...inside.declared,
      ].join("\n") + "\n";
    const about: Record<string, unknown> = { name: packageName, version: "1.0.0" };
    const typings = isPackage
      ? random.pick(["types", "typings", "exports", "beside", "@types", "index"] as const)
      : "none";
    if (inside.end === "js")
      about.type = inside.text.includes("export ") || inside.text.includes("import ") ? "module" : "commonjs";
    const declarationName = `${inside.name}.d.${{ mjs: "mts", cjs: "cts" }[inside.end] ?? "ts"}`;
    if (typings === "exports") about.exports = { ".": { types: `./${declarationName}`, default: `./${main}` } };
    else about.main = `./${main}`;
    if (typings === "types" || typings === "typings") {
      about[typings] = "./typings/own.d.ts";
      files[`${packageFolder}typings/own.d.ts`] = declarations.replaceAll(`"../../`, `"../../../`);
    } else if (typings === "exports" || typings === "beside")
      files[`${packageFolder}${declarationName}`] = declarations;
    else if (typings === "index") files[`${packageFolder}index.d.ts`] = declarations;
    else if (typings === "@types") {
      const folder = `node_modules/@types/${packageName.replace(/^@(\w+)\//, "$1__")}/`;
      files[`${folder}package.json`] =
        JSON.stringify(
          { name: `@types/${packageName.replace(/^@(\w+)\//, "$1__")}`, version: "1.0.0", types: "index.d.ts" },
          null,
          2,
        ) + "\n";
      files[`${folder}index.d.ts`] = packageName.includes("/")
        ? declarations.replaceAll(`"../../../`, `"../../../`)
        : declarations.replaceAll(`"../../`, `"../../../`);
    } else {
      // No typings in the package: the project says what the package exports.
      const type = kind.needs ? `import("./${declarationsOf[kind.needs].path}").${kind.needs}` : typeText;
      const lines = inside.text.includes("function make")
        ? [
            `export function make(${/function make\(turn\)/.test(inside.text) ? "turn: number" : ""}): ${/async function make/.test(inside.text) ? `Promise<${type}>` : type};`,
          ]
        : inside.text.includes("function each")
          ? [`export function each(callback: (x: ${type}) => void): void;`]
          : [`export const given: ${direction === "member" ? `{ held: ${type} }` : type};`];
      const imports = kindName === "box" ? ["  " + boxDeclaration.replaceAll("\n", "\n  ")] : [];
      files["ambient.d.ts"] =
        [`declare module ${JSON.stringify(packageName)} {`, ...imports, ...lines.map(line => "  " + line), "}"].join(
          "\n",
        ) + "\n";
    }
    files[`${packageFolder}package.json`] = JSON.stringify(about, null, 2) + "\n";
  }
  if (modules.some(module => module.end.endsWith("x"))) options.jsx = "preserve";
  // A project without a file for TypeScript to read is none.
  if (hasProject && (allowsJavaScript || modules.some(module => module.isTyped && !module.folder)))
    files["tsconfig.json"] = JSON.stringify({ compilerOptions: options }, null, 2) + "\n";
  const file = entry.path;
  const { [file]: text, ...others } = files;
  return { file, text, files: others };
}
