// One row for each thing that `bun build --minify-syntax` does to a program before it prints it, read off the visitor of the parser (src/js_parser/visit, src/js_parser/fold.rs,
// src/ast/known_global.rs) and off what the linker does with constants, enums and imports nobody uses.
//
// A row is a text, or a pair: declarations, one a line, and the code that uses them. Each row becomes up to four cases:
//
//   js               the row in one JavaScript file
//   ts               the same in TypeScript. `/*: T*/`, `/*as T*/`, `/*!*/` and `/*<T>*/` in a row are comments in JavaScript and what stands in them in TypeScript
//   js, two files    the declarations are the exports of another file
//   ts, two files
//
// N is a number and S a text that no build knows; effect(x) prints x and returns it. A row that names one of them gets its declaration.
// `onlyTyped`: the row is TypeScript's own syntax. `onlyUntyped`: the checker refuses the row, as it refuses a comparison that can never hold.
import type { Case } from "../minifying-first-saves-no-code";

type Row = string | [declarations: string, code: string];

const given = {
  N: "const N/*: number*/ = process.argv.length;",
  S: 'const S/*: string*/ = process.env.AOT_TEXT ?? "text";',
  effect: 'function effect/*<T>*/(value/*: T*/)/*: T*/ { console.log("effect", value); return value; }',
};

const groups: Record<string, Record<string, Row>> = {
  "constants are put where their names stand": {
    "a number, a text and a number": ["const a = 1;\nconst b = 2;", 'console.log(a + " hello " + b);'],
    "the default export": [
      "const a = 1;\nconst b = 2;",
      'const text = a + " hello " + b;\nexport default text;\nconsole.log(text);',
    ],
    "annotated constants": ["const a/*: number*/ = 1;\nconst b/*: string*/ = 'two';", "console.log(a + b);"],
    "a constant of constants": ["const a = 2;\nconst b = a * 21;\nconst c = b + 1;", "console.log(c);"],
    "a boolean decides a branch": ["const debug = false;", 'if (debug) console.log("never");\nconsole.log("done");'],
    "null and undefined": [
      "const nothing = null;\nconst missing = undefined;",
      'console.log(nothing ?? "a", missing ?? "b");',
    ],
    "inside a function": [
      "const rate = 3;",
      "function scale(x/*: number*/) { return x * rate * 2; }\nconsole.log(scale(N));",
    ],
    "inside a method": [
      "const prefix = 'id-';",
      "class Names { next(x/*: number*/) { return prefix + 'x' + x; } }\nconsole.log(new Names().next(N));",
    ],
    "inside an arrow in a loop": [
      "const step = 4;",
      "let sum = 0;\nfor (let i = 0; i < N; i++) sum += [i].map(x => x * step + step)[0]/*!*/;\nconsole.log(sum);",
    ],
    "a long text used once": [
      "const text = 'a text that is longer than any name would ever be';",
      "console.log(text);",
    ],
    "a text used twice": ["const text = 'short';", "console.log(text, text + '!');"],
    "a bigint": ["const big = 12345678901234567890n;", "console.log(big + 1n);"],
    "a negative number": ["const low = -5;", "console.log(low * low, -low);"],
    "a constant in a local scope": "function f() { const a = 6; const b = 7; return a * b; }\nconsole.log(f());",
    "a constant in a block": "{ const a = 6; const b = 7; console.log(a * b); }",
    "a let that is never assigned": ["let a = 5;", "console.log(a + 1);"],
    "a var that is never assigned": ["var a = 5;", "console.log(a + 1);"],
    "a constant as a property key": ["const key = 'name';", "const o = { [key]: N };\nconsole.log(o[key]);"],
    "a constant as a case label": [
      "const ONE = 1;\nconst TWO = 2;",
      "switch (N) { case ONE: console.log('one'); break; case TWO: console.log('two'); break; default: console.log('more'); }",
    ],
    "a constant as a default value": [
      "const size = 16;",
      "function f(x = size) { return x + size; }\nconsole.log(f(), f(N));",
    ],
    "a constant in a template": [
      "const who = 'world';\nconst times = 3;",
      "console.log(`hello ${who} ${times} times`);",
    ],
    "an unused constant": ["const unused = 1;\nconst used = 2;", "console.log(used);"],
    "an unused function": [
      "function unused() { return effect(1); }\nfunction used() { return 2; }",
      "console.log(used());",
    ],
    "an unused class": ["class Unused { x = 1; }\nclass Used { x = 2; }", "console.log(new Used().x);"],
  },
  "texts, numbers and templates are computed": {
    "texts joined": "console.log('a' + 'b' + 'c');",
    "a text and a number": "console.log('a' + 1, 1 + 'a', 1 + 2 + 'a', 'a' + 1 + 2);",
    "a text and null, undefined, booleans": "console.log('a' + null, 'a' + undefined, 'a' + true, false + 'a');",
    "texts joined around an unknown": "console.log('a' + 'b' + S + 'c' + 'd');",
    "texts joined behind an unknown": "console.log(S + 'a' + 'b');",
    "a template of constants": "console.log(`a${1}b${'c'}d${true}e${null}f${undefined}`);",
    "a template without parts": "console.log(`plain`);",
    "a template around an unknown": "console.log(`a${'b'}${S}${'c'}d`);",
    "a template and a text": "console.log(`a${S}` + 'b', 'a' + `b${S}`);",
    "a template in a template": "console.log(`a${`b${S}c`}d`);",
    "sums": "console.log(1 + 2, 3 - 1, 4 * 5, 9 / 3, 7 % 4, 2 ** 10);",
    "fractions": "console.log(0.1 + 0.2, 1 / 3, 5e-7 * 2);",
    "bit operations": "console.log(5 & 3, 5 | 3, 5 ^ 3, ~5, 1 << 4, -16 >> 2, -16 >>> 28);",
    "signs": "console.log(-(1), +(2), -(-3), +'4', -'5', +true, +null, +undefined, +'');",
    "not a number and infinities": "console.log(0 / 0, 1 / 0, -1 / 0, NaN + 1, Infinity - 1);",
    "a sum around an unknown": "console.log(N + 1 + 2, 1 + 2 + N, N * 2 * 3);",
    "comparisons of numbers": "console.log(1 < 2, 2 <= 2, 3 > 4, 4 >= 5);",
    "comparisons of texts": "console.log('a' < 'b', 'b' <= 'a', 'a' > 'b', 'abc' >= 'abd');",
    "the length of a text": "console.log('hello'.length, ''.length, 'hé'.length);",
    "the length of joined texts": "console.log(('ab' + 'cd').length);",
    "a character of a text": "console.log('hello'[0], 'hello'[4], 'hello'[9]);",
    "an element of a list": "console.log([10, 20, 30][1], [10, 20, 30][5]);",
    "the length of a list": "console.log([1, 2, 3].length);",
    "a list spread into a list": "console.log([1, ...[2, 3], 4, ...[]].length, [...[N, N]][1]);",
    "a list spread into a call": "console.log(...[1, 2], ...[3]);",
    "an object spread into an object": "console.log({ a: 1, ...{ b: 2 }, ...null, ...undefined, ...{} }.b);",
    "numbers in every notation": "console.log(0x10, 0b11, 0o17, 1_000, 1e3, .5);",
    "a number as text": "console.log(`${1e21}`, `${0.000001}`, `${-0}`, '' + 1.50);",
  },
  "typeof, void, ! and equality of constants": {
    "typeof of literals":
      "console.log(typeof 1, typeof 'a', typeof true, typeof null, typeof undefined, typeof 1n, typeof {}, typeof [], typeof (() => 1), typeof function () {}, typeof class {});",
    "typeof decides a branch": "if (typeof 1 === 'number') console.log('yes'); else console.log('no');",
    "typeof of a global that may be absent":
      "console.log(typeof nowhereDeclared === 'undefined' ? 'absent' : 'there');",
    "typeof against undefined":
      "console.log(typeof S === 'undefined', typeof S !== 'undefined', typeof S == 'undefined');",
    "typeof of a constant": [
      "const a = 1;\nconst b = 'x';",
      "console.log(typeof a === 'number' ? 'n' : 's', typeof b);",
    ],
    "typeof of a function declaration": ["function f() {}", "console.log(typeof f === 'function' ? 1 : 2);"],
    "typeof of a class": ["class C {}", "console.log(typeof C === 'function' ? 1 : 2);"],
    "void": "console.log(void 0, void 1, void 'a');",
    "void of an effect": "console.log(void effect(1));",
    "not of literals": "console.log(!0, !1, !'', !'a', !null, !undefined, !NaN, !{}, ![], !(() => 1), !0n, !1n);",
    "not of not": "console.log(!!N, !!!N, !!1);",
    "not of a comparison": "console.log(!(N === 1), !(N !== 1), !(N == 1), !(N != 1));",
    "not of not in a condition": "if (!!N) console.log('a');\nconsole.log(!!S ? 1 : 2);",
    "strict equality of literals":
      "console.log(1 === 1, 1 === 2, 'a' === 'a', 'a' === 'b', null === null, undefined === undefined, true === false);",
    "strict equality of other kinds": "console.log(1 === '1', null === undefined, 0 === false, '' === 0);",
    "loose equality of literals": "console.log(1 == 1, 1 == '1', null == undefined, 0 == false, '' == 0, null == 0);",
    "inequality of literals": "console.log(1 !== 1, 1 != 2, 'a' !== 'b', null != undefined);",
    "equality decides a branch": "if ('a' === 'b') console.log('never'); else console.log('always');",
    "equality with a boolean": "console.log(N > 1 === true, N > 1 === false, (N > 1) == true);",
    "equality of typeof": "console.log(typeof S === typeof S);",
    "delete of what is no reference": "console.log(delete 1);",
  },
  "?? || && and ?: on constants": {
    "?? on null and undefined": "console.log(null ?? 1, undefined ?? 2, void 0 ?? 3);",
    "?? on what is never null": "console.log(1 ?? effect(2), 'a' ?? effect(3), false ?? effect(4), {} ?? effect(5));",
    "|| on constants": "console.log(0 || 1, '' || 'b', null || 2, 1 || effect(3), 'a' || effect(4));",
    "&& on constants": "console.log(1 && 2, 'a' && 'b', 0 && effect(1), null && effect(2), '' && effect(3));",
    "a chain of &&": "console.log(true && true && N, true && false && effect(1));",
    "a chain of ||": "console.log(false || false || N, false || true || effect(1));",
    "an unknown && false in a condition": "if (N && false) console.log('never');\nconsole.log('done');",
    "an unknown || true in a condition": "if (N || true) console.log('always');",
    "?: on constants":
      "console.log(true ? 1 : effect(2), false ? effect(3) : 4, 1 ? 'a' : 'b', '' ? 'a' : 'b', null ? 1 : 2);",
    "?: with equal arms": "console.log(N ? 1 : 1, N > 2 ? S : S);",
    "?: with boolean arms": "console.log(N > 2 ? true : false, N > 2 ? false : true);",
    "?: of a negation": "console.log(!N ? 1 : 2);",
    "?: that is ||": "console.log(N ? N : 5, S ? S : 'x');",
    "?: that is &&": "console.log(N ? 5 : N);",
    "?: that is ??": "console.log(S != null ? S : 'x', S == null ? 'x' : S);",
    "?: in ?:": "console.log(N > 1 ? (true ? 'a' : 'b') : (false ? 'c' : 'd'));",
    "?: whose arms call the same function": "console.log(N > 2 ? effect(1) : effect(2));",
    "||= &&= ??= on constants":
      "let a/*: any*/ = null; a ??= 1; let b/*: any*/ = 0; b ||= 2; let c/*: any*/ = 1; c &&= 3;\nconsole.log(a, b, c);",
    "a constant decides && as a statement": "true && effect(1);\nfalse && effect(2);\nnull ?? effect(3);",
  },
  "branches that are never taken": {
    "if (false)": "if (false) { effect(1); }\nconsole.log('done');",
    "if (true) else": "if (true) { console.log('a'); } else { effect(1); }",
    "if (0), if (''), if (null)":
      "if (0) effect(1);\nif ('') effect(2);\nif (null) effect(3);\nif (undefined) effect(4);\nconsole.log('done');",
    "if (1) and if ('a')": "if (1) console.log('a'); else effect(1);\nif ('a') console.log('b'); else effect(2);",
    "else if": "if (false) effect(1); else if (true) console.log('b'); else effect(3);",
    "an empty if": "if (N) {}\nif (N) {} else {}\nconsole.log('done');",
    "an if with an empty arm": "if (N) {} else console.log('a');\nif (N > 99) console.log('b'); else {}",
    "an if around an effect with empty arms": "if (effect(1)) {}\nconsole.log('done');",
    "while (false)": "while (false) { effect(1); }\nconsole.log('done');",
    "for (;false;)":
      "for (; false; ) { effect(1); }\nfor (let i = effect(0); false; i++) { effect(2); }\nconsole.log('done');",
    "do while (false)": "do { console.log('once'); } while (false);",
    "behind return": "function f() { return 1; effect(2); }\nconsole.log(f());",
    "behind throw": "function f() { try { throw new Error('x'); effect(2); } catch { return 3; } }\nconsole.log(f());",
    "behind break and continue":
      "for (let i = 0; i < N; i++) { if (i) { continue; effect(1); } break; effect(2); }\nconsole.log('done');",
    "behind return in both arms":
      "function f(x/*: number*/) { if (x) { return 1; } else { return 2; } effect(3); }\nconsole.log(f(N));",
    "a function declared behind return": "function f() { return g(); function g() { return 4; } }\nconsole.log(f());",
    "a var declared in a dead branch": "if (false) { var late = effect(1); }\nconsole.log(typeof late);",
    "a dead branch names a large function":
      "function large(x/*: number*/) { let t = ''; for (let i = 0; i < x; i++) t += String(i) + [i, x].join('-'); return t; }\nif (false) console.log(large(N));\nconsole.log('done');",
    "a dead branch requires a module":
      "if (false) { console.log(require('node:http').STATUS_CODES); }\nconsole.log('done');",
    "a dead branch imports a module": "if (false) { import('node:http').then(console.log); }\nconsole.log('done');",
    "a dead arm of ?: requires a module": "console.log(true ? 'a' : require('node:zlib'));",
    "else behind a return":
      "function f(x/*: number*/) { if (x > 2) { return 'a'; } else { return 'b'; } }\nconsole.log(f(N));",
    "a return at the end": "function f() { console.log('x'); return; }\nf();",
    "return undefined":
      "function f() { console.log('x'); return undefined; }\nfunction g() { return void 0; }\nconsole.log(f(), g());",
    "ifs that return become one expression":
      "function f(x/*: number*/) { if (x === 1) return 'a'; if (x === 2) return 'b'; return 'c'; }\nconsole.log(f(N));",
    "nested ifs become &&": "if (N) { if (S) { console.log('both'); } }",
    "an empty try": "try {} catch { effect(1); }\ntry {} finally { console.log('f'); }",
    "an empty block and empty statements": "{}\n;;;\n{ {} { ; } }\nconsole.log('done');",
    "a label nobody names": "unused: { console.log('a'); }",
    "a constant behind a const decides": [
      "const mode = 'production';",
      "if (mode === 'development') { effect(1); } else { console.log('p'); }\nconsole.log(mode !== 'production' ? effect(2) : 'q');",
    ],
    "a number behind a const decides": [
      "const level = 2;",
      "if (level > 3) effect(1);\nif (level < 1) effect(2);\nconsole.log(level >= 2 ? 'high' : effect(3));",
    ],
  },
  "expressions nobody reads": {
    "literals as statements": "1;\n'a';\nnull;\nundefined;\ntrue;\n1n;\nconsole.log('done');",
    "names as statements": ["const a = 1;\nfunction f() {}\nclass C {}", "a;\nf;\nC;\nconsole.log('done');"],
    "operators on constants as statements": "1 + 2;\n!0;\ntypeof 1;\nvoid 0;\n'a' + 'b';\nconsole.log('done');",
    "objects, lists and functions as statements":
      "({});\n[];\n({ a: 1, b: [2] });\n(function () {});\n(() => 1);\n(class {});\n/x/;\n`t`;\nconsole.log('done');",
    "a list that holds an effect": "[1, effect(2), 3];\n({ a: effect(4) });",
    "an operator that holds an effect": "1 + effect(1);\n!effect(2);\ntypeof effect(3);",
    "a comparison of unknowns": "N === 1;\nN < 2;\ntypeof S;\n!N;\nconsole.log('done');",
    "a comma whose left is unused": "console.log((1, 2), ('a', N), (effect(1), 2));",
    "a call marked pure": "function make() { return effect(1); }\n/* @__PURE__ */ make();\nconsole.log('done');",
    "a construction marked pure":
      "class C { constructor() { effect(1); } }\n/* @__PURE__ */ new C();\nconsole.log('done');",
    "a pure call whose result nobody reads":
      "function make() { return [1, 2, 3].map(String); }\nconst unused = /* @__PURE__ */ make();\nconsole.log('done');",
    "a pure call with an effect among its arguments":
      "function make(x/*: number*/) { return x; }\n/* @__PURE__ */ make(effect(1));",
    "a function marked as without effects":
      "/* @__NO_SIDE_EFFECTS__ */ function make() { return effect(1); }\nmake();\nconsole.log('done');",
    "an unused local":
      "function f() { const unused = 1; let other = 'a'; var third = null; return 2; }\nconsole.log(f());",
    "an unused local that holds an object":
      "function f() { const unused = { a: 1, b: [1, 2] }; return 2; }\nconsole.log(f());",
    "an unused function expression's name": "const f = function named() { return 1; };\nconsole.log(f());",
    "an unused class expression's name": "const C = class Named { x = 1; };\nconsole.log(new C().x);",
    "unused collections":
      "new Map();\nnew Set();\nnew WeakMap();\nnew WeakSet();\nnew Map([]);\nnew Set([1, 2]);\nconsole.log('done');",
    "unused built-in constructions":
      "new Object();\nnew Array();\nnew Date();\nnew Error('x');\nnew RegExp('x');\nconsole.log('done');",
    "unused reads of globals": "Math;\nJSON;\nObject;\nMath.PI;\nNumber.MAX_SAFE_INTEGER;\nconsole.log('done');",
    "unused calls of pure built-ins":
      "Math.abs(1);\nObject.keys({});\nString(1);\nArray.isArray([]);\nconsole.log('done');",
    "an unused template with an unknown": "`a${N}`;\nconsole.log('done');",
    "an unused optional chain": "S?.length;\nconsole.log('done');",
  },
  "built-in constructors and calls on constants": {
    "new Object, new Array":
      "console.log(new Object(), new Array(), new Array(1, 2), new Array(N).length, Array(3).length);",
    "new Error without new": "console.log(new Error('a').message, Error('b').message, new TypeError('c').message);",
    "new Function, new RegExp": "console.log(new RegExp('a', 'g').flags, RegExp('b').source);",
    "Boolean, Number, String on constants":
      "console.log(Boolean(0), Boolean('a'), Number('12'), Number(true), String(12), String(null), String(true));",
    "Boolean in a condition": "if (Boolean(N)) console.log('a');\nconsole.log(Boolean(S) ? 1 : 2);",
    "String on an unknown": "console.log(String(N), '' + N, `${N}`);",
    "Number on an unknown": "console.log(Number(S), +S);",
    "Math constants": "console.log(Math.PI, Math.E, Math.SQRT2, Math.LN2);",
    "Math on constants":
      "console.log(Math.abs(-3), Math.floor(2.7), Math.ceil(2.1), Math.round(2.5), Math.trunc(-2.7), Math.sqrt(16), Math.max(1, 5, 3), Math.min(4, 2), Math.pow(2, 8), Math.sign(-9), Math.hypot(3, 4));",
    "Math.pow is **": "console.log(Math.pow(N, 2), N ** 2);",
    "Number constants":
      "console.log(Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Number.EPSILON, Number.MAX_VALUE, Number.POSITIVE_INFINITY, Number.NaN);",
    "Number predicates on constants":
      "console.log(Number.isInteger(5), Number.isInteger(5.5), Number.isNaN(NaN), Number.isFinite(1 / 0), isNaN(1), isFinite(1));",
    "parseInt and parseFloat on constants":
      "console.log(parseInt('42'), parseInt('ff', 16), parseFloat('1.5'), Number.parseInt('7'));",
    "methods of a constant text":
      "console.log('abc'.toUpperCase(), 'ABC'.toLowerCase(), ' a '.trim(), 'abc'.charAt(1), 'abc'.charCodeAt(1), 'abc'.indexOf('c'), 'abc'.includes('b'), 'abc'.startsWith('a'), 'abc'.endsWith('c'), 'abc'.slice(1), 'abc'.substring(0, 2), 'ab'.repeat(2), 'abc'.at(-1), 'a-b'.split('-').length, 'abc'.replace('b', 'x'), 'a'.padStart(3, '-'), 'a'.concat('b'));",
    "methods of a constant number": "console.log((255).toString(16), (1.005).toFixed(2), (5).toString());",
    "methods of a constant list":
      "console.log([1, 2, 3].join('-'), [1, 2, 3].includes(2), [1, 2, 3].indexOf(3), [3, 4].at(-1), [1, 2].concat([3]).length);",
    "String.fromCharCode": "console.log(String.fromCharCode(65, 66), String.fromCodePoint(128512).length);",
    "String.raw": "console.log(String.raw`a\\n${1}b`);",
    "Array.isArray on literals": "console.log(Array.isArray([]), Array.isArray({}), Array.isArray('a'));",
    "Object.keys of a literal":
      "console.log(Object.keys({ a: 1, b: 2 }).length, Object.values({ a: 1 })[0], Object.entries({ a: 1 }).length);",
    "JSON on constants": "console.log(JSON.stringify({ a: 1 }), JSON.stringify('x'), JSON.parse('{\"a\":1}').a);",
    "Symbol.for": "console.log(Symbol.for('a') === Symbol.for('a'), Symbol.for('b').description);",
    "a member of an object literal": "console.log({ a: 1, b: 2 }.b, { a: 1 }['a'], ({ a: { b: 3 } }).a.b);",
    "a member of a constant object": [
      "const config = { port: 80, name: 'x', nested: { deep: true } };",
      "console.log(config.port + 1, config.name + '!', config.nested.deep ? 'd' : effect(1));",
    ],
    "a member of a frozen object": [
      "const config = Object.freeze({ port: 80, debug: false });",
      "if (config.debug) effect(1);\nconsole.log(config.port + 1);",
    ],
    "a member of an object as const": [
      "const config = { port: 80, debug: false } /*as const*/;",
      "if (config.debug) effect(1);\nconsole.log(config.port + 1);",
    ],
    "an element of a constant list": ["const list = [10, 20, 30];", "console.log(list[1]/*!*/ + 1, list.length);"],
  },
  "names in brackets, keys and shorthand": {
    "a text in brackets is a name":
      "const o/*: Record<string, number>*/ = { a: N };\nconsole.log(o['a'], o['a' + ''], o[`a`]);",
    "joined texts in brackets": "const o/*: Record<string, number>*/ = { ab: N };\nconsole.log(o['a' + 'b']);",
    "a computed key that is a text": "const o = { ['a']: N, ['b' + 'c']: 2, [`d`]: 3 };\nconsole.log(o.a, o.bc, o.d);",
    "a computed key that is a number":
      "const o/*: Record<number, number>*/ = { [1]: N, [1 + 1]: 2 };\nconsole.log(o[1], o[2]);",
    "a quoted key": "const o = { 'a': N, 'b-c': 2 };\nconsole.log(o.a, o['b-c']);",
    "a computed method name":
      "class C { ['run']() { return N; } static ['make']() { return new C(); } }\nconsole.log(C.make().run());",
    "a number as a text key": "const o/*: Record<string, number>*/ = { 1: N };\nconsole.log(o['1'], o[1]);",
  },
  "commas, sequences and statements joined": {
    "statements become a sequence": "effect(1);\neffect(2);\neffect(3);",
    "a sequence in a return": "function f() { effect(1); effect(2); return 3; }\nconsole.log(f());",
    "a sequence in a condition": "effect(1);\nif (effect(2)) console.log('a');",
    "a sign of a sequence": "console.log(-(effect(1), 2), !(effect(3), 0));",
    "declarations joined":
      "const a = effect(1);\nconst b = effect(2);\nlet c = effect(3);\nlet d = effect(4);\nconsole.log(a, b, c, d);",
    "a declaration moved into a for": "let i = 0;\nfor (; i < N; i++) effect(i);",
    "a local used once is put where it is used":
      "function f(x/*: number*/) { const y = x * 2; return y + 1; }\nconsole.log(f(N));",
    "a local used once in a call":
      "function f(x/*: number*/) { const y = effect(x); return effect(y); }\nconsole.log(f(N));",
    "an if becomes &&": "if (N) effect(1);\nif (!N) effect(2);",
    "an if and else become ?:": "if (N) effect(1); else effect(2);",
    "an if and else that assign": "let a;\nif (N) a = 1; else a = 2;\nconsole.log(a);",
    "an if and else that return":
      "function f(x/*: number*/) { if (x) return effect(1); else return effect(2); }\nconsole.log(f(N));",
    "an assignment with its operator": "let a = N;\na = a + 1;\na = a * 2;\na = a - 3;\nconsole.log(a);",
    "an arrow with one return": "const f = (x/*: number*/) => { return x + 1; };\nconsole.log(f(N));",
    "a block with one statement": "if (N) { effect(1); }\nfor (let i = 0; i < 1; i++) { effect(i); }",
    "while (true) is for (;;)": "let i = 0;\nwhile (true) { if (i++ > N) break; }\nconsole.log(i);",
    "a loop that begins with a break":
      "let i = 0;\nfor (;;) { if (i >= N) break; i++; }\nwhile (true) { if (!(i > 0)) break; i--; }\nconsole.log(i);",
  },
  "switch": {
    "on a constant number":
      "switch (2) { case 1: effect(1); break; case 2: console.log('two'); break; default: effect(3); }",
    "on a constant text":
      "switch ('b') { case 'a': effect(1); break; case 'b': console.log('b'); break; case 'c': effect(3); }",
    "on a constant that no case has": "switch (9) { case 1: effect(1); break; default: console.log('default'); }",
    "on a constant that falls through":
      "switch (1) { case 1: console.log('one'); case 2: console.log('two'); break; case 3: effect(3); }",
    "on a const": [
      "const kind = 'b';",
      "switch (kind) { case 'a': effect(1); break; case 'b': console.log('b'); break; default: effect(3); }",
    ],
    "on true":
      "switch (true) { case N > 100: effect(1); break; case false: effect(2); break; default: console.log('d'); }",
    "without cases": "switch (effect(1)) {}\nswitch (N) { default: }\nconsole.log('done');",
    "with a default alone": "switch (N) { default: console.log('d'); }",
    "typeof of a literal":
      "switch (typeof 1) { case 'string': effect(1); break; case 'number': console.log('n'); break; }",
  },
  "optional chains": {
    "on null and undefined":
      "console.log(null?.a, undefined?.a, null?.[effect(1)], undefined?.(effect(2)), (void 0)?.a.b.c);",
    "on what is never null": "console.log('abc'?.length, [1]?.length, ({ a: 1 })?.a, (() => 1)?.());",
    "on a constant": ["const nothing = null;\nconst text = 'abc';", "console.log(nothing?.a, text?.length);"],
    "delete on null": "console.log(delete null?.a);",
    "a chain with ??": "console.log(null?.a ?? 'x', undefined?.a.b ?? 'y');",
    "on this of a module": "console.log(this?.a);",
  },
  "functions called where they are written": {
    "an arrow that returns a constant": "console.log((() => 1)());",
    "an arrow with a body": "console.log((() => { return 'a' + 'b'; })());",
    "an empty arrow": "(() => {})();\nconsole.log((() => {})());",
    "an empty function": "(function () {})();\nconsole.log((function () {})());",
    "an arrow around statements": "(() => { effect(1); effect(2); })();",
    "an arrow with a parameter":
      "console.log(((x/*: number*/) => x + 1)(N), ((x/*: number*/, y/*: number*/) => x * y)(2, 3));",
    "an async arrow": "(async () => { console.log('a'); })();",
    "an arrow that holds constants":
      "const value = (() => { const a = 2; const b = 3; return a * b; })();\nconsole.log(value);",
    "an empty function declared and called": [
      "function nothing() {}",
      "nothing();\nnothing(1, 2);\nconsole.log(nothing());",
    ],
    "an identity function": [
      "function same/*<T>*/(x/*: T*/)/*: T*/ { return x; }",
      "console.log(same(1), same('a') + 'b', same(N));",
    ],
    "a function that returns a constant": [
      "function answer() { return 42; }",
      "console.log(answer() + 1, answer() === 42 ? 'y' : effect(1));",
    ],
    "a function that returns a constant decides": [
      "function isDebug() { return false; }",
      "if (isDebug()) effect(1);\nconsole.log('done');",
    ],
    "a small function of constants": [
      "function add(a/*: number*/, b/*: number*/) { return a + b; }",
      "console.log(add(1, 2), add(add(1, 2), 3));",
    ],
  },
  classes: {
    "an empty static block": "class C { static {} x = 1; }\nconsole.log(new C().x);",
    "a static block of constants": "class C { static a = 1; static { 1 + 2; } }\nconsole.log(C.a);",
    "a static block that assigns": "class C { static a/*: number*/; static { C.a = 1 + 2; } }\nconsole.log(C.a);",
    "a static block with a dead branch":
      "class C { static a = 1; static { if (false) effect(1); } }\nconsole.log(C.a);",
    "a static constant field": [
      "class Limits { static max = 10; static min = 1; }",
      "console.log(Limits.max - Limits.min, Limits.max > 5 ? 'big' : effect(1));",
    ],
    "a static readonly field": ["class Limits { static /*readonly */max = 10; }", "console.log(Limits.max * 2);"],
    "an empty constructor": "class C { constructor() {} x = 1; }\nconsole.log(new C().x);",
    "a constructor that only calls super":
      "class A { x = 1; }\nclass B extends A { constructor(...rest/*: []*/) { super(...rest); } }\nconsole.log(new B().x);",
    "fields of constants":
      "class C { a = 1 + 2; b = 'x' + 'y'; c = typeof 1; }\nconst c = new C();\nconsole.log(c.a, c.b, c.c);",
    "a method with a dead branch":
      "class C { run(x/*: number*/) { if (false) effect(1); return true ? x : effect(2); } }\nconsole.log(new C().run(N));",
    "an unused private method":
      "class C { #unused() { return effect(1); } run() { return 1; } }\nconsole.log(new C().run());",
    "a class used for its static method alone": [
      "class Tools { static twice(x/*: number*/) { return x * 2; } static unused() { return effect(1); } }",
      "console.log(Tools.twice(N));",
    ],
  },
  "using": {
    "using null and undefined": "{ using a = null; using b = undefined; console.log('in'); }\nconsole.log('out');",
  },
  "process.env, NODE_ENV and what the build knows of the target": {
    "process.env.NODE_ENV decides":
      "if (process.env.NODE_ENV === 'production') console.log('p'); else console.log('d');",
    "process.env.NODE_ENV in ?:": "console.log(process.env.NODE_ENV !== 'production' ? 'dev' : 'prod');",
    "process.env.NODE_ENV in brackets": "console.log(process.env['NODE_ENV'] === 'production' ? 'prod' : 'dev');",
    "typeof window, document, Bun, process":
      "console.log(typeof window === 'undefined' ? 'server' : 'browser', typeof document, typeof Bun !== 'undefined' ? 'bun' : 'other', typeof process);",
    "process.platform and process.arch decide":
      "if (process.platform === 'win32') console.log('w'); else console.log('u');\nconsole.log(process.arch === 'x64' || process.arch === 'arm64' ? 'known' : 'other');",
    "import.meta.main":
      "if (import.meta.main) console.log('main'); else console.log('not main');\nconsole.log(!import.meta.main);",
    "typeof require, module, exports": "console.log(typeof require, typeof module, typeof exports);",
  },
};

const onlyTyped: Record<string, Record<string, Row>> = {
  enums: {
    "members are numbers": [
      "enum Color { Red, Green, Blue }",
      "console.log(Color.Green, Color.Blue + 1, Color.Red === 0 ? 'zero' : effect(1));",
    ],
    "members are texts": [
      "enum Name { A = 'a', B = 'b' }",
      "console.log(Name.A + Name.B, Name.A === 'a' ? 'y' : effect(1));",
    ],
    "members are computed": [
      "enum Bits { A = 1 << 0, B = 1 << 1, C = A | B, D = C * 2 + 1, E = ~A, F = 'x'.length }",
      "console.log(Bits.A, Bits.B, Bits.C, Bits.D, Bits.E, Bits.F);",
    ],
    "members name other enums": ["enum A { X = 5 }\nenum B { Y = A.X + 1 }", "console.log(B.Y);"],
    "a const enum": [
      "const enum Flag { None = 0, Read = 1, Write = 2, Both = Read | Write }",
      "console.log(Flag.Both, Flag.Read | Flag.Write, (N & Flag.Write) !== 0);",
    ],
    "a const enum of texts": [
      "const enum Kind { A = 'kind-a', B = 'kind-b' }",
      "console.log(Kind.A, `${Kind.B}!`, Kind.A + Kind.B);",
    ],
    "a member in brackets": ["enum Color { Red, Green }", "console.log(Color['Green'], Color[`Red`]);"],
    "a member as a key": [
      "enum Key { Name = 'name' }",
      "const o = { [Key.Name]: N };\nconsole.log(o[Key.Name], o.name);",
    ],
    "a member as a case label": [
      "enum Kind { A, B, C }",
      "function f(k/*: Kind*/) { switch (k) { case Kind.A: return 'a'; case Kind.B: return 'b'; default: return 'c'; } }\nconsole.log(f(N % 3));",
    ],
    "a switch on a member": [
      "enum Kind { A, B }",
      "switch (Kind.B as Kind) { case Kind.A: effect(1); break; case Kind.B: console.log('b'); break; }",
    ],
    "a member decides a branch": [
      "enum Level { Off, On }\nconst level = Level.Off;",
      "if (level as Level === Level.On) effect(1);\nconsole.log('done');",
    ],
    "the name of a member": ["enum Color { Red, Green }", "console.log(Color[0], Color[Color.Green]);"],
    "an enum nobody reads": ["enum Unused { A, B }\nenum Used { C = 7 }", "console.log(Used.C);"],
    "an enum read only by members": [
      "enum Size { S = 1, M = 2, L = 3 }",
      "let sum = 0;\nfor (let i = 0; i < N; i++) sum += i * Size.M + Size.L;\nconsole.log(sum);",
    ],
    "an enum in two parts": ["enum Parts { A = 1 }\nenum Parts { B = 2 }", "console.log(Parts.A + Parts.B);"],
    "an enum handed out whole": ["enum Color { Red, Green }", "console.log(Object.keys(Color).length, Color.Green);"],
    "an enum in a function": "function f() { enum Local { A = 3, B } return Local.A * Local.B; }\nconsole.log(f());",
    "an enum in a namespace": [
      "namespace Shapes { export enum Kind { Round = 4, Square } }",
      "console.log(Shapes.Kind.Square);",
    ],
    "a declared const enum": "declare const enum Outside { A = 9 }\nconsole.log(Outside.A);",
  },
  namespaces: {
    "a constant of a namespace": [
      "namespace Config { export const port = 80; export const name = 'x'; }",
      "console.log(Config.port + 1, Config.name + '!');",
    ],
    "a function of a namespace": [
      "namespace Tools { export function twice(x: number) { return x * 2; } export function unused() { return effect(1); } }",
      "console.log(Tools.twice(N));",
    ],
    "a namespace in a namespace": [
      "namespace A { export namespace B { export const c = 5; } }",
      "console.log(A.B.c * 2);",
    ],
    "a namespace of types alone": [
      "namespace Types { export type T = number; export interface I { a: T } }",
      "const x: Types.I = { a: N };\nconsole.log(x.a);",
    ],
    "an empty namespace": ["namespace Empty {}", "console.log('done');"],
    "a namespace nobody reads": [
      "namespace Unused { export const a = effect; }\nnamespace Used { export const b = 2; }",
      "console.log(Used.b);",
    ],
    "an alias of a member": ["namespace A { export const b = 5; }", "import b = A.b;\nconsole.log(b + 1);"],
  },
  "what only the checker reads": {
    "as, satisfies, ! and <T>":
      "console.log((1 as number) + (2 satisfies number), ('a' as string) + 'b', (<number>3) * 2, 'x'!.length);",
    "as const":
      "const a = 1 as const;\nconst b = 'x' as const;\nconsole.log(a + b, typeof a === 'number' ? 'n' : effect(1));",
    "types, interfaces and declarations":
      "type T = number;\ninterface I { a: T }\ndeclare const nowhere: I;\ndeclare function absent(): void;\nabstract class A { abstract run(): void; }\nconsole.log('done');",
    "overloads":
      "function f(x: number): number;\nfunction f(x: string): string;\nfunction f(x: any) { return x; }\nconsole.log(f(1));",
    "parameter properties":
      "class P { constructor(public x: number, private readonly y = 2) {} sum() { return this.x + this.y; } }\nconsole.log(new P(N).sum());",
    "declared fields":
      "class C { declare a: number; b?: number; c!: number; d = 1; }\nconsole.log(Object.keys(new C()).length);",
    "this as a parameter": "function f(this: void, x: number) { return x + 1; }\nconsole.log(f(N));",
    "a literal type decides": "const mode: 'a' | 'b' = 'a';\nconsole.log(mode === 'a' ? 'first' : effect(1));",
  },
};

const onlyUntyped = new Set<string>([
  "?? || && and ?: on constants: && on constants",
  "?? || && and ?: on constants: ?: on constants",
  "?? || && and ?: on constants: ?? on null and undefined",
  "?? || && and ?: on constants: ?? on what is never null",
  "?? || && and ?: on constants: a constant decides && as a statement",
  "?? || && and ?: on constants: || on constants",
  "branches that are never taken: a constant behind a const decides",
  "branches that are never taken: a var declared in a dead branch",
  "branches that are never taken: if (0), if (''), if (null)",
  "branches that are never taken: if (1) and if ('a')",
  "expressions nobody reads: a comma whose left is unused",
  "functions called where they are written: an empty function declared and called",
  "optional chains: on a constant",
  "optional chains: on this of a module",
  "process.env, NODE_ENV and what the build knows of the target: typeof window, document, Bun, process",
  "switch: on a const",
  "switch: on a constant number",
  "switch: on a constant text",
  "switch: on a constant that falls through",
  "switch: on a constant that no case has",
  "switch: on true",
  "texts, numbers and templates are computed: an object spread into an object",
  "texts, numbers and templates are computed: signs",
  "typeof, void, ! and equality of constants: delete of what is no reference",
  "typeof, void, ! and equality of constants: equality decides a branch",
  "typeof, void, ! and equality of constants: inequality of literals",
  "typeof, void, ! and equality of constants: loose equality of literals",
  "typeof, void, ! and equality of constants: not of literals",
  "typeof, void, ! and equality of constants: strict equality of literals",
  "typeof, void, ! and equality of constants: strict equality of other kinds",
  "typeof, void, ! and equality of constants: typeof of a global that may be absent",
]);

// What the bundler does while it links files. Each is written in JavaScript; `typed()` gives the same files the extension of TypeScript.
const linked: Record<string, Record<string, string>> = {
  "a program of two files": { "entry.js": 'import "./other";\nconsole.log("a");', "other.js": 'console.log("b");' },
  "a namespace read by constant names": {
    "entry.js": 'import * as all from "./values";\nconsole.log(all.a + " hello " + all.b, all["a"] + 1);',
    "values.js": "export const a = 1;\nexport const b = 2;\nexport const unused = 3;",
  },
  "a namespace read for a name that is not there": {
    "entry.js": 'import * as all from "./values";\nconsole.log(all.a, typeof all.missing);',
    "values.js": "export const a = 1;",
  },
  "a namespace whose function is called": {
    "entry.js": 'import * as tools from "./tools";\nconsole.log(tools.twice(process.argv.length));',
    "tools.js":
      "export function twice(x) { return x * 2; }\nexport function unused(x) { console.log(x); return [x, x].join(); }",
  },
  "a namespace exported again": {
    "entry.js": 'import { values } from "./barrel";\nconsole.log(values.a + values.b);',
    "barrel.js": 'export * as values from "./values";',
    "values.js": "export const a = 1;\nexport const b = 2;",
  },
  "export * through a barrel": {
    "entry.js": 'import { a, b } from "./barrel";\nconsole.log(a + " hello " + b);',
    "barrel.js": 'export * from "./first";\nexport * from "./second";',
    "first.js": "export const a = 1;\nexport const unusedFirst = 'x';",
    "second.js": "export const b = 2;\nexport function unusedSecond() { return [1, 2, 3].map(String).join(); }",
  },
  "export { } from through two barrels": {
    "entry.js": 'import { c } from "./outer";\nconsole.log(c * 2);',
    "outer.js": 'export { b as c } from "./inner";',
    "inner.js": 'export { a as b } from "./values";',
    "values.js": "export const a = 21;",
  },
  "a default export that is a constant": {
    "entry.js": 'import limit from "./limit";\nconsole.log(limit + 1, limit > 5 ? "big" : "small");',
    "limit.js": "export default 10;",
  },
  "a default export that is computed of constants": {
    "entry.js": 'import text from "./text";\nconsole.log(text);',
    "text.js": 'const a = 1;\nconst b = 2;\nexport default a + " hello " + b;',
  },
  "a constant of a constant of another file": {
    "entry.js": 'import { c } from "./c";\nconsole.log(c + 1);',
    "c.js": 'import { b } from "./b";\nexport const c = b * 2;',
    "b.js": 'import { a } from "./a";\nexport const b = a + 1;',
    "a.js": "export const a = 20;",
  },
  "a flag of another file decides what is imported": {
    "entry.js":
      'import { debug } from "./flags";\nimport { log } from "./log";\nif (debug) log("never");\nconsole.log("done");',
    "flags.js": "export const debug = false;",
    "log.js": "export function log(text) { console.log([text, text.length, text.toUpperCase()].join(' ')); }",
  },
  "a flag of another file decides what is required": {
    "entry.js":
      'import { debug } from "./flags";\nif (debug) console.log(require("node:http").STATUS_CODES);\nconsole.log("done");',
    "flags.js": "export const debug = false;",
  },
  "an import nobody uses": {
    "entry.js": 'import { unused } from "./quiet";\nconsole.log("done");',
    "quiet.js": "export const unused = 1;\nexport function alsoUnused() { return [1, 2].map(x => x * 2); }",
  },
  "an import nobody uses of a file that prints": {
    "entry.js": 'import { unused } from "./loud";\nconsole.log("done");',
    "loud.js": 'console.log("loud");\nexport const unused = 1;',
  },
  "a file imported for nothing": {
    "entry.js": 'import "./quiet";\nconsole.log("done");',
    "quiet.js": "export const a = 1;\nfunction f() { return 2; }",
  },
  "an empty file": { "entry.js": 'import "./empty";\nconsole.log("done");', "empty.js": "" },
  "a package that says it has no side effects": {
    "entry.js": 'import { used } from "pkg";\nconsole.log(used);',
    "node_modules/pkg/package.json": '{ "name": "pkg", "main": "index.js", "type": "module", "sideEffects": false }',
    "node_modules/pkg/index.js": 'export { used } from "./used.js";\nexport { unused } from "./unused.js";',
    "node_modules/pkg/used.js": "export const used = 7;",
    "node_modules/pkg/unused.js":
      "globalThis.never = [1, 2, 3].map(String);\nexport const unused = globalThis.never.join();",
  },
  "a package without side effects imported for nothing": {
    "entry.js": 'import "pkg";\nconsole.log("done");',
    "node_modules/pkg/package.json": '{ "name": "pkg", "main": "index.js", "type": "module", "sideEffects": false }',
    "node_modules/pkg/index.js": "globalThis.never = [1, 2, 3].map(String);",
  },
  "a member of a JSON file": {
    "entry.js": 'import data from "./data.json";\nconsole.log(data.version + "!", data.nested.port + 1);',
    "data.json": '{ "version": "1.2.3", "nested": { "port": 80 }, "unused": [1, 2, 3, { "a": "b" }] }',
  },
  "a named member of a JSON file": {
    "entry.js": 'import { version } from "./data.json";\nconsole.log(version + "!");',
    "data.json": '{ "version": "1.2.3", "unused": { "large": [1, 2, 3, 4, 5, 6, 7, 8] } }',
  },
  "a function of another file that returns a constant": {
    "entry.js": 'import { isDebug } from "./flags";\nif (isDebug()) console.log("never");\nconsole.log("done");',
    "flags.js": "export function isDebug() { return false; }",
  },
  "an empty function of another file": {
    "entry.js": 'import { nothing } from "./nothing";\nnothing();\nnothing(1);\nconsole.log("done");',
    "nothing.js": "export function nothing() {}",
  },
  "a class of another file nobody constructs": {
    "entry.js": 'import { used } from "./both";\nconsole.log(used());',
    "both.js":
      "export class Unused { constructor() { this.a = [1, 2, 3]; } run() { return this.a.map(String); } }\nexport function used() { return 1; }",
  },
  "a CommonJS file required for a constant": {
    "entry.js": 'const { a, b } = require("./values.cjs");\nconsole.log(a + " hello " + b);',
    "values.cjs": "exports.a = 1;\nexports.b = 2;\nexports.unused = function () { return [1, 2].join(); };",
  },
  "a CommonJS file imported for a constant": {
    "entry.js": 'import { a } from "./values.cjs";\nconsole.log(a + 1);',
    "values.cjs": "module.exports = { a: 1, unused: 2 };",
  },
  "a constant read before its file has run": {
    "entry.js": 'import { a } from "./first";\nconsole.log(a);',
    "first.js": 'import { b } from "./second";\nexport const a = 1;\nconsole.log(b);',
    "second.js": 'import { a } from "./first";\nexport const b = 2;\nexport function late() { return a; }',
  },
};

const linkedInTypeScript: Record<string, Record<string, string>> = {
  "an enum of another file": {
    "entry.ts": 'import { Color } from "./color";\nconsole.log(Color.Green, Color.Blue + 1);',
    "color.ts": "export enum Color { Red, Green, Blue }",
  },
  "a const enum of another file": {
    "entry.ts": 'import { Flag } from "./flag";\nconsole.log(Flag.Both, Flag.Read | Flag.Write);',
    "flag.ts": "export const enum Flag { Read = 1, Write = 2, Both = Read | Write }",
  },
  "an enum through a barrel": {
    "entry.ts": 'import { Color } from "./barrel";\nconsole.log(Color.Green);',
    "barrel.ts": 'export * from "./color";',
    "color.ts": "export enum Color { Red, Green }",
  },
  "an enum through a namespace": {
    "entry.ts": 'import * as all from "./color";\nconsole.log(all.Color.Green, all.Color["Red"]);',
    "color.ts": "export enum Color { Red, Green }",
  },
  "an enum of another file decides": {
    "entry.ts":
      'import { Level, level } from "./level";\nif ((level as Level) === Level.Debug) console.log("never");\nconsole.log("done");',
    "level.ts": "export enum Level { Off, Debug }\nexport const level = Level.Off;",
  },
  "an enum whose members name an enum of another file": {
    "entry.ts": 'import { B } from "./b";\nconsole.log(B.Y);',
    "b.ts": 'import { A } from "./a";\nexport enum B { Y = A.X + 1 }',
    "a.ts": "export enum A { X = 5 }",
  },
  "an import of a type alone": {
    "entry.ts":
      'import { Shape } from "./shape";\nimport type { Other } from "./shape";\nconst s: Shape & Other = { a: 1 };\nconsole.log(s.a);',
    "shape.ts": 'console.log("shape");\nexport interface Shape { a: number }\nexport type Other = { a: number };',
  },
  "a namespace of another file": {
    "entry.ts": 'import { Config } from "./config";\nconsole.log(Config.port + 1);',
    "config.ts": "export namespace Config { export const port = 80; export const unused = [1, 2, 3]; }",
  },
  "import = require": {
    "entry.ts": 'import values = require("./values.cjs");\nconsole.log(values.a + 1);',
    "values.cjs": "module.exports = { a: 1 };",
    "values.d.cts": "declare const values: { a: number };\nexport = values;",
  },
};

const typed = (files: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(files).map(([path, text]) => [
      path.includes("node_modules") ? path : path.replace(/\.js$/, ".ts"),
      text,
    ]),
  );
// The checker refuses these as TypeScript: a name that a namespace does not have, `require` without its declaration, parameters without a type, a CommonJS file without declarations.
const linkedOnlyUntyped =
  /not there|required|CommonJS|whose function|a flag of another file decides what is imported|a package|an empty function/;

const explicit: Record<string, Case> = {};
for (const [name, files] of Object.entries(linked)) {
  explicit[`files are linked: ${name} [js]`] = { files };
  if (!linkedOnlyUntyped.test(name)) explicit[`files are linked: ${name} [ts]`] = { files: typed(files) };
}
for (const [name, files] of Object.entries(linkedInTypeScript)) explicit[`files are linked: ${name} [ts]`] = { files };

const defined: Record<string, [define: Record<string, string>, code: string]> = {
  "a name": [{ DEBUG: "false" }, "if (DEBUG) console.log('never');\nconsole.log(DEBUG ? 'a' : 'b');"],
  "a text": [
    { VERSION: '"1.2.3"' },
    "console.log(VERSION + '!', VERSION.length, VERSION === '1.2.3' ? 'same' : 'other');",
  ],
  "a number": [{ LIMIT: "10" }, "console.log(LIMIT + 1, LIMIT > 5 ? 'big' : 'small');"],
  "a member of process.env": [
    { "process.env.MODE": '"fast"' },
    "if (process.env.MODE === 'slow') console.log('never');\nconsole.log(process.env.MODE);",
  ],
  "process.env.NODE_ENV": [
    { "process.env.NODE_ENV": '"production"' },
    "if (process.env.NODE_ENV !== 'production') console.log('never');\nconsole.log(process.env.NODE_ENV + '!');",
  ],
  "typeof of a name": [
    { "typeof window": '"undefined"' },
    "console.log(typeof window === 'undefined' ? 'server' : 'browser');",
  ],
  "a member of a global": [{ "globalThis.FEATURE": "true" }, "console.log(globalThis.FEATURE ? 'on' : 'off');"],
  "an object": [
    { CONFIG: '{"port":80,"debug":false}' },
    "if (CONFIG.debug) console.log('never');\nconsole.log(CONFIG.port + 1);",
  ],
  "a name for another name": [{ LOG: "console.log" }, "LOG('a');"],
};
for (const [name, [define, code]] of Object.entries(defined))
  explicit[`--define: ${name} [js]`] = { files: { "entry.js": code + "\n" }, define };

function file(text: string, isTyped: boolean) {
  const needed = Object.entries(given).filter(([name]) => new RegExp(`\\b${name}\\b`).test(text)).map(([, declaration]) => declaration + "\n"); // prettier-ignore
  const whole = needed.join("") + text + "\n";
  return isTyped
    ? whole.replace(/\/\*(:|as |!|<|readonly )(.*?)\*\//g, "$1$2")
    : whole.replace(/\/\*(:|as |!|<|readonly )(.*?)\*\//g, "");
}

const declared = /^(?:declare )?(?:const enum|enum|const|let|var|function\*?|class|namespace)\s+([A-Za-z_$][\w$]*)/gm;

function casesOf(name: string, row: Row, kinds: readonly ("js" | "ts")[]) {
  const cases: Record<string, Case> = {};
  const [declarations, code] = typeof row === "string" ? ["", row] : row;
  for (const kind of kinds) {
    if (kind === "ts" && onlyUntyped.has(name)) continue;
    const isTyped = kind === "ts";
    cases[`${name} [${kind}]`] = {
      files: { ["entry." + kind]: file((declarations && declarations + "\n") + code, isTyped) },
    };
    if (!declarations) continue;
    const names = [...new Set([...declarations.matchAll(declared)].map(match => match[1]))];
    cases[`${name} [${kind}, two files]`] = {
      files: {
        ["entry." + kind]: file(`import { ${names.join(", ")} } from "./declarations";\n${code}`, isTyped),
        ["declarations." + kind]: file(declarations.replace(declared, "export $&"), isTyped),
      },
    };
  }
  return cases;
}

export const rows: Record<string, Case> = { ...explicit };
for (const [group, all] of Object.entries(groups))
  for (const [name, row] of Object.entries(all)) Object.assign(rows, casesOf(`${group}: ${name}`, row, ["js", "ts"]));
for (const [group, all] of Object.entries(onlyTyped))
  for (const [name, row] of Object.entries(all)) Object.assign(rows, casesOf(`${group}: ${name}`, row, ["ts"]));
