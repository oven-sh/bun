// An object that a top-level binding holds is filled through another name for it. Whoever reads the binding first, in its own module, in another one or in a circle of imports, finds it filled.
import { programsOf } from "../generate";

const names: Record<string, string> = {
  "a-condition": "const target = flag ? spare : table;",
  "two-conditions": "const target = flag ? spare : count > 5 ? spare : table;",
  "a-switch": "let target; switch (count) { case 1: target = spare; break; case 2: target = table; break; default: target = spare; }",
  "if-and-else": "let target; if (flag) target = spare; else target = table;",
  "an-if-that-stores-again": "let target = spare; if (!flag) target = table;",
  "or": "const target = (flag ? spare : undefined) || table;",
  "nullish": "const target = (flag ? spare : undefined) ?? table;",
  "and": "const target = (flag ? undefined : spare) && table;",
  "a-comma": "const target = (count, table);",
  "a-function-that-returns-its-argument": "const same = value => value; const target = same(table);",
  "a-function-that-chooses": "function choose(a, b) { return flag ? a : b; } const target = choose(spare, table);",
  "a-parameter": "const target = table; (filled => { filled.zero = zero; })(flag ? spare : table);",
  "the-object-function": "const target = Object(table);",
  "what-assign-returns": "const target = Object.assign(table, {});",
  "an-array-pattern": "const [target] = [table, spare];",
  "an-object-pattern": "const { target } = { target: table };",
  "an-element": "const target = [spare, table][flag ? 0 : 1];",
  "a-member-by-key": "const target = { a: spare, b: table }[flag ? 'a' : 'b'];",
  "try-and-finally": "let target; try { target = flag ? spare : table; } finally { count; }",
  "try-and-catch": "let target; try { if (flag) throw 1; target = table; } catch { target = spare; }",
  "the-last-turn-of-a-loop": "let target = spare; for (let i = 0; i < count; i++) target = i ? table : spare;",
  "a-loop-over-both": "let target = table; for (const each of [spare, table]) each.zero = zero;",
  "a-labeled-block": "let target = spare; pick: { if (flag) break pick; target = table; }",
  "a-second-binding": "const target = table;",
  "a-default-parameter": "const target = ((a = table) => a)();",
  "a-rest-parameter": "const target = ((...all) => all[flag ? 0 : 1])(spare, table);",
  "a-map": "const target = new Map([['k', table]]).get('k');",
  "a-static-field": "class Holder { static held = flag ? spare : table; } const target = Holder.held;",
  "a-static-block": "let target; class Holder { static { target = flag ? spare : table; } }",
  "a-generator": "const target = (function* () { yield table; })().next().value;",
  "a-test-of-a-type": "const target = typeof count === 'number' ? table : spare;",
};
const fills: Record<string, string> = {
  "stores": "target.one = one; target.two = two; target.three = three;",
  "assign": "Object.assign(target, { one, two, three });",
  "stores-by-key-in-a-loop": "for (const [key, value] of [['one', one], ['two', two], ['three', three]]) target[key] = value;",
};
const show = "value => Object.keys(value).join()";
const flags = "export const flag = process.argv.length > 100;\nexport const count = process.argv.length > 100 ? 7 : 2;\n";
const tables = (name: string, fill: string, head: string, tail: string) => `import { count, flag } from "./flags.js";
${head}export const table = {};
export const spare = {};
const zero = () => 0, one = () => 1, two = () => 2, three = () => 3;
${names[name]}
${fills[fill]}
export function called() { return zero() + one() + two() + three() + " " + typeof target; }
${tail}`;
const readers: Record<string, (name: string, fill: string) => Record<string, string>> = {
  "its-own-module": (name, fill) => ({
    "main.js": `// The module that holds the object reads it first.\nimport "./tables.js";\n`,
    "tables.js": tables(name, fill, "", `const show = ${show};\nconsole.log(show(table), "|", show(spare));\nconsole.log(called(), "|", show(table), "|", show(spare));\n`),
  }),
  "another-module": (name, fill) => ({
    "main.js": `// Another module reads the object first.\nimport { called, spare, table } from "./tables.js";\nconst show = ${show};\nconsole.log(show(table), "|", show(spare));\nconsole.log(called(), "|", show(table), "|", show(spare));\n`,
    "tables.js": tables(name, fill, "", ""),
  }),
  "a-circle-of-imports": (name, fill) => ({
    "main.js": `// A module that imports the one with the object, and is imported by it, reads the object first.\nimport "./tables.js";\n`,
    "reader.js": `import { spare, table } from "./tables.js";\nconst show = ${show};\nexport const shown = () => show(table) + " | " + show(spare);\n`,
    "tables.js": tables(name, fill, `import { shown } from "./reader.js";\n`, `console.log(shown());\nconsole.log(called(), "|", shown());\n`),
  }),
};

// An initializer that throws, or that runs code of the program, does so where it stands, though nobody ever reads what it makes.
// Each line: a name ||| statements, of which MADE(..) is what the binding holds ### what stands behind the binding.
// A binding that nobody reads tests nothing here: the bundler drops it, or its store goes, and no initializer is put off. A function reads each of these, behind a test that never passes.
const initializers = String.raw`
indexof-of-objects-from-a-bigint ||| const list = [{}, {}]; MADE(list.indexOf(1, 10n))
lastindexof-of-objects-from-a-bigint ||| const list = [{}, {}]; MADE(list.lastIndexOf(1, 10n))
includes-of-objects-from-a-bigint ||| const list = [{}, {}]; MADE(list.includes(1, 10n))
indexof-of-objects-from-a-symbol ||| const list = [{}, {}]; MADE(list.indexOf(1, Symbol.iterator))
includes-of-objects-from-an-object-that-throws ||| const list = [{}, {}]; MADE(list.includes(1, { valueOf() { throw new RangeError("x"); } }))
join-of-objects ||| const list = [{ toString() { throw new RangeError("x"); } }]; MADE(list.join())
join-of-a-list-that-got-a-symbol ||| const list = ["a"]; list.push(Symbol()); MADE(list.join())
join-of-a-list-whose-element-became-a-symbol ||| const list = ["a", "b"]; list[1] = Symbol(); MADE(list.join())
sort-of-a-list-that-got-a-symbol ||| const list = ["b", "a"]; list.push(Symbol()); MADE(list.sort())
sort-of-a-list-that-got-an-object-that-throws ||| const list = ["b", "a"]; list.push({ toString() { throw new RangeError("x"); } }); MADE(list.sort())
concat-of-a-list-with-a-spreadable-that-throws ||| const list = [1]; MADE(list.concat({ get [Symbol.isConcatSpreadable]() { throw new RangeError("x"); } }))
push-on-a-list-frozen-through-an-alias ||| const list = [1]; const alias = list; Object.freeze(alias); MADE(list.push(2))
push-on-a-sealed-list ||| const list = [1]; Object.seal(list); MADE(list.push(2))
push-on-a-list-that-takes-no-more ||| const list = [1]; Object.preventExtensions(list); MADE(list.push(2))
pop-on-a-list-whose-length-is-read-only ||| const list = [1]; Object.defineProperty(list, "length", { writable: false }); MADE(list.pop())
store-past-a-length-that-is-read-only-strict ||| "use strict"; const list = [1]; Object.defineProperty(list, "length", { writable: false }); list[1] = 2; MADE(list)
store-to-an-index-that-is-read-only-strict ||| "use strict"; const list = [1]; Object.defineProperty(list, 0, { writable: false }); list[0] = 2; MADE(list)
store-to-an-index-with-a-setter ||| const list = [1]; Object.defineProperty(list, 0, { set(v) { throw new RangeError("x"); } }); list[0] = 2; MADE(list)
read-of-an-index-with-a-getter ||| const list = [1]; Object.defineProperty(list, 0, { get() { throw new RangeError("x"); } }); MADE(list[0])
spread-of-a-list-with-a-getter ||| const list = [1]; Object.defineProperty(list, 0, { get() { throw new RangeError("x"); } }); MADE([...list])
set-of-a-list-with-a-getter ||| const list = [1]; Object.defineProperty(list, 0, { get() { throw new RangeError("x"); } }); MADE(new Set(list))
set-of-a-list-with-its-own-iterator ||| const list = [1]; list[Symbol.iterator] = function () { throw new RangeError("x"); }; MADE(new Set(list))
map-of-a-list-with-its-own-iterator ||| const list = [[1, 2]]; list[Symbol.iterator] = function () { throw new RangeError("x"); }; MADE(new Map(list))
spread-of-a-list-with-its-own-iterator ||| const list = [1]; list[Symbol.iterator] = function () { throw new RangeError("x"); }; MADE([...list])
set-of-a-list-below-another-prototype ||| const list = [1]; Object.setPrototypeOf(list, { [Symbol.iterator]() { throw new RangeError("x"); } }); MADE(new Set(list))
set-of-a-list-below-null ||| const list = [1]; Object.setPrototypeOf(list, null); MADE(new Set(list))
set-of-a-list-below-null-by-proto ||| const list = [1]; list.__proto__ = null; MADE(new Set(list))
map-of-pairs-one-of-which-has-a-getter ||| const pair = [1, 2]; Object.defineProperty(pair, 0, { get() { throw new RangeError("x"); } }); MADE(new Map([pair]))
set-of-a-set-with-its-own-iterator ||| const s = new Set([1]); s[Symbol.iterator] = function () { throw new RangeError("x"); }; MADE(new Set(s))
map-of-a-map-with-its-own-iterator ||| const m = new Map([[1, 2]]); m[Symbol.iterator] = function () { throw new RangeError("x"); }; MADE(new Map(m))
spread-of-a-set-with-its-own-iterator ||| const s = new Set([1]); s[Symbol.iterator] = function () { throw new RangeError("x"); }; MADE([...s])
set-of-a-set-below-null ||| const s = new Set([1]); Object.setPrototypeOf(s, null); MADE(new Set(s))
add-on-a-set-with-its-own-add-is-fine ||| const s = new Set([1]); s.add = function () { throw new RangeError("x"); }; MADE(new Set(s))
own-add-is-called ||| const s = new Set([1]); s.add = function () { throw new RangeError("x"); }; MADE(s.add(2))
keys-of-a-literal-with-a-getter-is-fine ||| const o = { get a() { throw new RangeError("x"); } }; MADE(Object.keys(o))
values-of-a-literal-with-a-getter ||| const o = { get a() { throw new RangeError("x"); } }; MADE(Object.values(o))
entries-of-a-literal-that-got-a-getter ||| const o = { a: 1 }; Object.defineProperty(o, "a", { get() { throw new RangeError("x"); }, enumerable: true }); MADE(Object.entries(o))
assign-from-a-literal-that-got-a-getter ||| const o = { a: 1 }; Object.defineProperty(o, "a", { get() { throw new RangeError("x"); }, enumerable: true }); MADE(Object.assign({}, o))
assign-to-a-literal-that-got-a-setter ||| const o = { a: 1 }; Object.defineProperty(o, "a", { set(v) { throw new RangeError("x"); } }); MADE(Object.assign(o, { a: 2 }))
assign-to-a-frozen-literal ||| const o = Object.freeze({ a: 1 }); MADE(Object.assign(o, { a: 2 }))
assign-to-a-literal-frozen-through-an-alias ||| const o = { a: 1 }; const alias = o; Object.freeze(alias); MADE(Object.assign(o, { a: 2 }))
spread-of-a-literal-that-got-a-getter ||| const o = { a: 1 }; Object.defineProperty(o, "a", { get() { throw new RangeError("x"); }, enumerable: true }); MADE({ ...o })
read-of-a-literal-that-got-a-getter ||| const o = { a: 1 }; Object.defineProperty(o, "a", { get() { throw new RangeError("x"); } }); MADE(o.a)
store-to-a-literal-that-got-a-setter ||| const o = { a: 1 }; Object.defineProperty(o, "a", { set(v) { throw new RangeError("x"); } }); o.a = 2; MADE(o)
store-to-a-literal-whose-field-became-read-only-strict ||| "use strict"; const o = { a: 1 }; Object.defineProperty(o, "a", { writable: false }); o.a = 2; MADE(o)
store-to-a-literal-below-a-setter ||| const o = { a: 1 }; Object.setPrototypeOf(o, { set b(v) { throw new RangeError("x"); } }); o.b = 2; MADE(o)
store-to-a-literal-below-a-setter-by-proto-in-the-literal ||| const o = { __proto__: { set b(v) { throw new RangeError("x"); } }, a: 1 }; o.b = 2; MADE(o)
read-of-a-literal-below-a-getter ||| const o = { __proto__: { get b() { throw new RangeError("x"); } }, a: 1 }; MADE(o.b)
store-below-a-frozen-prototype-strict ||| "use strict"; const o = { __proto__: Object.freeze({ b: 1 }) }; o.b = 2; MADE(o)
store-by-a-computed-key-proto-of-a-number-is-fine ||| const o = {}; const k = "__proto__"; o[k] = 5; MADE(o)
store-by-a-computed-key-proto-makes-a-circle ||| const o = {}; const p = { __proto__: o }; const k = "__pro" + "to__"; o[k] = p; MADE(o)
store-proto-makes-a-circle ||| const o = {}; const p = { __proto__: o }; o.__proto__ = p; MADE(o)
store-to-a-function-of-a-name-that-is-read-only-above-strict ||| "use strict"; function f() {} f[Symbol.hasInstance] = 1; MADE(f)
store-to-a-frozen-function-strict ||| "use strict"; function f() {} Object.freeze(f); f.x = 1; MADE(f)
store-length-of-a-function-strict ||| "use strict"; function f() {} f.length = 1; MADE(f)
store-prototype-of-an-arrow-is-fine ||| "use strict"; const f = () => {}; f.prototype = 1; MADE(f)
store-prototype-of-a-method-is-fine ||| "use strict"; const f = { m() {} }.m; f.prototype = 1; MADE(f)
store-prototype-of-a-class-strict ||| "use strict"; class A {} A.prototype = 1; MADE(A)
store-prototype-of-a-generator-is-fine ||| "use strict"; function* g() {} g.prototype = 1; MADE(g)
store-caller-of-a-strict-function ||| "use strict"; function f() {} f.caller = 1; MADE(f)
store-arguments-of-an-arrow ||| const f = () => {}; f.arguments = 1; MADE(f)
define-name-of-a-class-by-a-static-field-is-fine ||| MADE(class { static name = 1; })
static-method-by-a-key-that-becomes-prototype ||| const k = ["proto", "type"].join(""); MADE(class { static [k]() {} })
static-method-by-a-key-that-is-a-number ||| const k = 1; MADE(class { static [k]() {} })
static-accessor-by-the-key-prototype ||| const k = "prototype"; MADE(class { static set [k](v) {} })
method-by-a-key-that-throws ||| const k = { toString() { throw new RangeError("x"); } }; MADE(class { [k]() {} })
literal-method-by-a-key-that-throws ||| const k = { toString() { throw new RangeError("x"); } }; MADE({ [k]() {} })
literal-by-a-key-that-is-a-symbol-is-fine ||| const k = Symbol(); MADE({ [k]: 1 })
class-below-a-class-in-its-dead-zone ||| MADE(class extends Later {}) ### class Later {}
class-below-null-is-fine ||| MADE(class extends null {})
class-below-undefined ||| const u = undefined; MADE(class extends u {})
class-below-a-function-with-a-getter-for-prototype ||| function f() {} Object.defineProperty(f, "prototype", { value: 5 }); MADE(class extends f {})
class-below-a-bound-class ||| class A {} const B = A.bind(null); MADE(class extends B {})
class-below-function-prototype ||| MADE(class extends Function.prototype {})
class-below-reflect ||| MADE(class extends Reflect {})
class-below-proxy ||| MADE(class extends Proxy {})
class-below-a-proxy-of-a-class ||| class A {} const P = new Proxy(A, { get(t, k) { if (k === "prototype") throw new RangeError("x"); return t[k]; } }); MADE(class extends P {})
construct-a-class-called-without-new ||| class A {} MADE(A())
construct-an-arrow ||| const f = () => {}; MADE(new f())
construct-a-method ||| const f = { m() {} }.m; MADE(new f())
derived-constructor-without-super ||| class A {} class B extends A { constructor() {} } MADE(new B())
derived-constructor-that-returns-a-number ||| class A {} class B extends A { constructor() { super(); return 1; } } MADE(new B())
constructor-that-reads-this-before-super ||| class A {} class B extends A { constructor() { this.x = 1; super(); } } MADE(new B())
super-twice ||| class A {} class B extends A { constructor() { super(); super(); } } MADE(new B())
private-method-on-another-object ||| class A { #p() {} static t(o) { return o.#p(); } } MADE(A.t({}))
private-field-defined-twice ||| class Base { constructor(o) { return o; } } class A extends Base { #p = 1; } const o = {}; new A(o); MADE(new A(o))
field-definition-on-a-frozen-object ||| class Base { constructor(o) { return o; } } class A extends Base { p = 1; } MADE(new A(Object.freeze({})))
helper-that-loops-for-a-count-and-throws-at-the-end ||| function h(n) { let s = 0; for (let i = 0; i < n; i++) s += i; if (s > 3) throw new RangeError("x"); return s; } MADE(h(5))
helper-that-reads-a-constant-in-its-dead-zone ||| function h() { return later; } MADE(h()) ### const later = 1;
regular-expression-match-on-a-pattern-with-lastindex-a-symbol ||| const r = /a/g; r.lastIndex = Symbol(); MADE(r.test("a"))
replace-with-a-frozen-global-pattern ||| const r = /a/g; Object.freeze(r); MADE("aa".replace(r, "b"))
match-with-a-pattern-whose-exec-is-its-own ||| const r = /a/; r.exec = function () { throw new RangeError("x"); }; MADE(r.test("a"))
replace-with-a-pattern-whose-flags-are-its-own ||| const r = /a/g; Object.defineProperty(r, "flags", { get() { throw new RangeError("x"); } }); MADE("aa".replace(r, "b"))
replaceall-with-a-pattern-whose-flags-are-its-own ||| const r = /a/g; Object.defineProperty(r, "flags", { value: "" }); MADE("aa".replaceAll(r, "b"))
split-with-a-pattern-whose-constructor-is-its-own ||| const r = /a/; r.constructor = { [Symbol.species]: function () { throw new RangeError("x"); } }; MADE("bab".split(r))
match-with-a-pattern-whose-own-symbol-match-throws ||| const r = /a/; r[Symbol.match] = function () { throw new RangeError("x"); }; MADE("a".match(r))
startswith-with-a-pattern ||| const r = /a/; MADE("a".startsWith(r))
freeze-then-define ||| const o = { a: 1 }; Object.freeze(o); MADE(Object.defineProperty(o, "a", { value: 2 }))
freeze-then-delete-strict ||| "use strict"; const o = { a: 1 }; Object.freeze(o); delete o.a; MADE(o)
freeze-then-set-prototype ||| const o = { a: 1 }; Object.freeze(o); MADE(Object.setPrototypeOf(o, null))
freeze-then-store-in-a-helper-strict ||| "use strict"; function h(x) { x.a = 2; } const o = { a: 1 }; Object.freeze(o); MADE(h(o))
freeze-then-store-in-another-block-strict ||| "use strict"; const o = { a: 1 }; Object.freeze(o); if (o.a === 1) { o.a = 2; } MADE(o)
freeze-in-a-branch-then-store-strict ||| "use strict"; const o = { a: 1 }; if (o.a === 1) Object.freeze(o); o.a = 2; MADE(o)
freeze-a-list-then-sort ||| const list = [2, 1]; Object.freeze(list); MADE(list.sort())
freeze-an-inner-literal-then-store-strict ||| "use strict"; const o = { inner: { a: 1 } }; Object.freeze(o.inner); o.inner.a = 2; MADE(o)
define-a-property-twice-through-two-names ||| function f() {} const g = f; Object.defineProperty(f, "x", { value: 1 }); MADE(Object.defineProperty(g, "x", { value: 2 }))
define-a-property-that-a-helper-has-defined ||| function h(x) { Object.defineProperty(x, "x", { value: 1 }); } function f() {} h(f); MADE(Object.defineProperty(f, "x", { value: 2 }))
define-a-property-with-a-descriptor-below-a-getter ||| function f() {} MADE(Object.defineProperty(f, "x", { __proto__: { get get() { throw new RangeError("x"); } }, value: 1 }))
define-a-symbol-twice ||| function f() {} Object.defineProperty(f, Symbol.hasInstance, { value: 1 }); MADE(Object.defineProperty(f, Symbol.hasInstance, { value: 2 }))
define-name-read-only-then-store-strict ||| "use strict"; function f() {} Object.defineProperty(f, "x", { value: 1 }); f.x = 2; MADE(f)
pair-changed-by-a-function-called-in-between ||| const pair = [1, 2]; function poke() { Object.defineProperty(pair, 0, { get() { throw new RangeError("x"); } }); } poke(); MADE(new Map([pair]))
list-changed-by-a-function-called-in-between ||| const list = [[1, 2]]; function poke() { list.push(7); } poke(); MADE(new Map(list))
list-for-a-set-changed-by-a-function-called-in-between ||| const list = [1]; function poke() { Object.defineProperty(list, 0, { get() { throw new RangeError("x"); } }); } poke(); MADE(new Set(list))
literal-changed-by-a-function-called-in-between ||| const o = { a: 1 }; function poke() { Object.defineProperty(o, "a", { get() { throw new RangeError("x"); }, enumerable: true }); } poke(); MADE(Object.values(o))
literal-inside-a-literal-changed-in-between ||| const inner = { a: 1 }; const outer = { inner }; function poke() { Object.defineProperty(inner, "a", { get() { throw new RangeError("x"); }, enumerable: true }); } poke(); MADE(outer.inner.a)
list-inside-a-list-changed-in-between-then-flattened ||| const inner = [1]; const outer = [inner]; Object.defineProperty(inner, 0, { get() { throw new RangeError("x"); } }); MADE(outer.flat())
list-inside-a-list-changed-then-concat-spread ||| const inner = [1]; Object.defineProperty(inner, 0, { get() { throw new RangeError("x"); } }); MADE([].concat(inner))
list-inside-a-list-changed-then-joined ||| const inner = [1]; const outer = [inner]; Object.defineProperty(inner, 0, { get() { throw new RangeError("x"); } }); MADE(outer.join())
list-inside-a-list-changed-then-spread-twice ||| const inner = [1]; const outer = [inner]; Object.defineProperty(inner, 0, { get() { throw new RangeError("x"); } }); MADE([...outer[0]])
literal-with-a-getter-inside-a-list-then-assigned-from ||| const inner = { a: 1 }; Object.defineProperty(inner, "a", { get() { throw new RangeError("x"); }, enumerable: true }); const outer = [inner]; MADE(Object.assign({}, outer[0]))
literal-with-a-getter-spread-through-a-field ||| const inner = { a: 1 }; Object.defineProperty(inner, "a", { get() { throw new RangeError("x"); }, enumerable: true }); const outer = { inner }; MADE({ ...outer.inner })
set-inside-a-list-with-its-own-iterator ||| const s = new Set([1]); s[Symbol.iterator] = function () { throw new RangeError("x"); }; const outer = [s]; MADE(new Set(outer[0]))
function-with-a-read-only-property-stored-through-a-field-strict ||| "use strict"; function f() {} Object.defineProperty(f, "x", { value: 1 }); const o = { f }; o.f.x = 2; MADE(o)
function-with-a-read-only-property-by-defineproperties-strict ||| "use strict"; function f() {} Object.defineProperties(f, { x: { value: 1 } }); f.x = 2; MADE(f)
function-with-a-read-only-property-by-reflect-strict ||| "use strict"; function f() {} Reflect.defineProperty(f, "x", { value: 1 }); f.x = 2; MADE(f)
function-sealed-then-a-new-property-strict ||| "use strict"; function f() {} Object.seal(f); f.x = 2; MADE(f)
function-with-a-setter-that-throws ||| function f() {} Object.defineProperty(f, "x", { set(v) { throw new RangeError("x"); } }); f.x = 2; MADE(f)
function-below-a-prototype-with-a-setter ||| function f() {} Object.setPrototypeOf(f, { set x(v) { throw new RangeError("x"); } }); f.x = 2; MADE(f)
class-with-a-static-setter-that-throws ||| class A { static set x(v) { throw new RangeError("x"); } } A.x = 1; MADE(A)
class-below-a-class-with-a-static-setter ||| class A { static set x(v) { throw new RangeError("x"); } } class B extends A {} B.x = 1; MADE(B)
class-with-a-static-getter-only-strict ||| "use strict"; class A { static get x() { return 1; } } A.x = 1; MADE(A)
static-field-over-a-static-getter-is-fine ||| class A { static get x() { return 1; } static x = 2; } MADE(A)
static-field-named-by-a-key-that-is-prototype ||| const k = "prototype"; MADE(class { static [k] = 1; })
static-field-named-name-then-frozen-in-a-static-block ||| MADE(class { static { Object.freeze(this); } static x = 1; })
prototype-method-store-on-a-frozen-prototype-strict ||| "use strict"; function F() {} Object.freeze(F.prototype); F.prototype.m = 1; MADE(F)
prototype-replaced-by-a-frozen-literal-then-stored-strict ||| "use strict"; function F() {} F.prototype = Object.freeze({}); F.prototype.m = 1; MADE(F)
indexof-from-a-bigint ||| MADE([1, 2, 3].indexOf(2, 10n))
lastindexof-from-a-bigint ||| MADE([1, 2, 3].lastIndexOf(2, 10n))
includes-from-a-bigint ||| MADE([1, 2, 3].includes(2, 10n))
indexof-from-a-symbol ||| MADE([1, 2, 3].indexOf(2, Symbol.iterator))
includes-from-a-symbol ||| MADE([1, 2, 3].includes(2, Symbol()))
map-of-pairs-then-a-number-pushed ||| const a = [[1, 2]]; a.push(7); MADE(new Map(a))
map-of-pairs-then-an-element-stored ||| const a = [[1, 2]]; a[0] = 7; MADE(new Map(a))
map-of-pairs-then-an-element-added ||| const a = [[1, 2]]; a[1] = "x"; MADE(new Map(a))
map-of-pairs-with-a-hole ||| const a = [[1, 2]]; a[2] = [3, 4]; MADE(new Map(a))
map-of-pairs-then-unshift ||| const a = [[1, 2]]; a.unshift(1); MADE(new Map(a))
map-of-pairs-then-fill ||| const a = [[1, 2]]; a.fill(1); MADE(new Map(a))
map-of-a-longer-list ||| const a = [[1, 2]]; a.length = 3; MADE(new Map(a))
static-method-named-prototype-by-a-computed-key ||| const k = "prototype"; MADE(class { static [k]() {} })
static-method-named-prototype-by-a-joined-key ||| const k = "proto" + "type"; MADE(class { static [k]() {} })
static-getter-named-prototype ||| const k = "prototype"; MADE(class { static get [k]() { return 1; } })
class-extends-symbol ||| MADE(class extends Symbol {})
class-extends-bigint ||| MADE(class extends BigInt {})
class-extends-math-max ||| MADE(class extends Math.max {})
class-extends-parseint ||| MADE(class extends parseInt {})
class-extends-an-arrow ||| const f = () => {}; MADE(class extends f {})
class-extends-a-generator ||| function* g() {} MADE(class extends g {})
class-extends-an-async-function ||| async function g() {} MADE(class extends g {})
class-extends-a-method ||| const o = { m() {} }; MADE(class extends o.m {})
class-extends-a-function-whose-prototype-is-a-number ||| function f() {} f.prototype = 3; MADE(class extends f {})
class-extends-a-bound-function ||| function f() {} const b = f.bind(null); MADE(class extends b {})
with-out-of-range ||| MADE([1, 2, 3].with(10, 1))
with-negative-out-of-range ||| MADE([1, 2, 3].with(-4, 1))
tosorted-with-a-number ||| MADE([1, 2, 3].toSorted(5))
sort-with-a-number ||| MADE([1, 2, 3].sort(5))
sort-with-null ||| MADE([1, 2, 3].sort(null))
join-of-a-symbol ||| MADE([Symbol()].join())
join-with-a-symbol ||| MADE([1, 2].join(Symbol()))
push-on-a-frozen-list ||| const a = Object.freeze([1]); MADE(a.push(2))
pop-on-a-frozen-list ||| const a = Object.freeze([1]); MADE(a.pop())
reverse-on-a-frozen-list ||| const a = Object.freeze([1, 2]); MADE(a.reverse())
fill-on-a-frozen-list ||| const a = Object.freeze([1, 2]); MADE(a.fill(0))
shift-on-a-frozen-list ||| const a = Object.freeze([1, 2]); MADE(a.shift())
store-to-a-frozen-list-strict ||| "use strict"; const a = Object.freeze([1, 2]); a[0] = 9; MADE(a)
store-to-a-frozen-literal-strict ||| "use strict"; const a = Object.freeze({ x: 1 }); a.x = 9; MADE(a)
store-to-a-sealed-literal-strict ||| "use strict"; const a = Object.seal({ x: 1 }); a.y = 9; MADE(a)
store-to-a-literal-that-takes-no-more-strict ||| "use strict"; const a = Object.preventExtensions({ x: 1 }); a.y = 9; MADE(a)
define-on-a-frozen-literal ||| const a = Object.freeze({ x: 1 }); MADE(Object.defineProperty(a, "y", { value: 1 }))
define-twice-on-a-function ||| function f() {} Object.defineProperty(f, "x", { value: 1 }); MADE(Object.defineProperty(f, "x", { value: 2 }))
define-name-then-length-on-a-function ||| function f() {} Object.defineProperty(f, "name", { value: 1 }); MADE(Object.defineProperty(f, "name", { value: 2, writable: true, enumerable: true }))
define-on-a-frozen-function ||| function f() {} Object.freeze(f); MADE(Object.defineProperty(f, "x", { value: 2 }))
define-on-a-function-that-takes-no-more ||| function f() {} Object.preventExtensions(f); MADE(Object.defineProperty(f, "x", { value: 2 }))
store-to-a-function-that-takes-no-more-strict ||| "use strict"; function f() {} Object.preventExtensions(f); f.x = 1; MADE(f)
store-name-of-a-function-strict ||| "use strict"; function f() {} f.name = "x"; MADE(f)
store-to-a-class-static-that-is-read-only-strict ||| "use strict"; class A {} A.prototype = {}; MADE(A)
symbol-plus-text ||| MADE(Symbol() + "")
template-of-a-symbol ||| MADE("".concat(Symbol()))
bigint-plus-number ||| MADE(1n + 1)
replaceall-with-a-pattern-that-is-not-global ||| MADE("abc".replaceAll(/a/, "b"))
match-with-lastindex-that-cannot-be-written ||| const r = /a/g; Object.freeze(r); MADE("aaa".replace(r, "b"))
test-with-a-frozen-sticky-pattern ||| const r = /a/y; Object.freeze(r); MADE(r.test("aaa"))
exec-with-a-frozen-global-pattern ||| const r = /a/g; Object.freeze(r); MADE(r.exec("aaa"))
lastindex-that-throws ||| const r = /a/g; r.lastIndex = { valueOf() { throw new RangeError("x"); } }; MADE(r.test("aaa"))
lastindex-that-is-a-symbol ||| const r = /a/g; r.lastIndex = Symbol(); MADE(r.exec("aaa"))
lastindex-that-is-a-bigint ||| const r = /a/y; r.lastIndex = 1n; MADE(r.test("aaa"))
spread-of-a-number ||| MADE([...7])
spread-of-undefined ||| MADE([...undefined])
object-spread-of-null-is-fine ||| MADE({ ...null })
symbol-of-a-symbol ||| MADE(Symbol(Symbol()))
symbol-for-of-a-symbol ||| MADE(Symbol.for(Symbol()))
in-on-a-number ||| MADE("a" in 7)
instanceof-a-number ||| MADE({} instanceof 7)
instanceof-an-arrow ||| const f = () => {}; MADE({} instanceof f)
read-of-null ||| const o = null; MADE(o.x)
map-of-pairs-then-a-pair-emptied ||| const p = [1, 2]; const a = [p]; p.length = 0; MADE(new Map(a))
map-of-pairs-then-reversed-is-fine ||| const a = [[1, 2], [3, 4]]; a.reverse(); MADE(new Map(a))
map-of-pairs-then-popped-and-a-text-pushed ||| const a = [[1, 2]]; a.pop(); a.push("ab"); MADE(new Map(a))
map-of-pairs-then-concat-result ||| const a = [[1, 2]].concat(7); MADE(new Map(a))
map-of-pairs-then-sorted ||| const a = [[1, 2], [0, 1]]; a.sort(); a[0] = null; MADE(new Map(a))
map-of-pairs-through-a-spread ||| const a = [[1, 2], ...[7]]; MADE(new Map(a))
map-of-pairs-then-spliced ||| const a = [[1, 2]]; a.splice(0, 1, 5); MADE(new Map(a))
map-of-pairs-with-copywithin ||| const a = [[1, 2], 3]; MADE(new Map(a))
weak-set-of-a-list-with-a-number ||| const a = [{}]; a.push(1); MADE(new WeakSet(a))
weak-map-of-pairs-with-a-number-key ||| const a = [[{}, 1]]; a.push([1, 1]); MADE(new WeakMap(a))
set-of-a-list-is-fine ||| const a = [1]; a.push(2); MADE(new Set(a))
set-of-a-map-that-was-made ||| const m = new Map([[1, 2]]); MADE(new Set(m))
map-of-a-set-that-was-made ||| const s = new Set([1]); MADE(new Map(s))
map-of-a-set-of-pairs ||| const s = new Set([[1, 2]]); MADE(new Map(s))
map-of-a-set-of-pairs-then-a-number ||| const s = new Set([[1, 2]]); s.add(3); MADE(new Map(s))
spread-of-a-made-list-into-a-map ||| const a = [[1, 2]]; a.push(1); MADE(new Map([...a]))
object-from-entries-of-numbers ||| const a = [[1, 2]]; a.push(1); MADE(Object.fromEntries(a))
`;
const bindings: Record<string, (before: string, made: string, behind: string) => string> = {
  "a-list": (before, made, behind) => `${before}\nconst held = [${made}, filler()];\n${behind}`,
  "a-field": (before, made, behind) => `${before}\nconst held = { field: ${made}, other: filler() };\n${behind}`,
  "what-a-function-returns": (before, made, behind) =>
    `function make() {\n${before}\nreturn [${made}, filler()];\n${behind}\n}\nconst held = make();`,
};
const modulesInOneProgram = 40;
function initializersThatNobodyReads() {
  const files: Record<string, string> = {};
  const cases = initializers
    .trim()
    .split("\n")
    .map(
      line => /^(?<name>\S+) \|\|\| (?<before>.*?)MADE\((?<made>.*)\);?(?: ### (?<behind>.*))?$/.exec(line)!.groups!,
    );
  for (const binding in bindings)
    for (let first = 0; first < cases.length; first += modulesInOneProgram) {
      const folder = `nobody-reads-${binding}-${first / modulesInOneProgram + 1}`;
      const part = [
        { name: "nothing-but-a-literal", before: "", made: "{ b: 2 }" },
        ...cases.slice(first, first + modulesInOneProgram),
      ];
      for (const { name, before, made, behind = "" } of part)
        files[`${folder}/${name}.js`] =
          `function filler() {\n  return { a: 1 };\n}\n${bindings[binding](before, made, behind)}\n` +
          `function read() {\n  return held;\n}\nif (process.argv.length > 100) console.log(read());\n`;
      files[`${folder}/main.js`] =
        `// Modules whose initializers nobody reads run them, or fail in them, as in plain Bun.\n// STATISTIC: InitializersDeferred >= 1\n` +
        `async function attempt(name, load) {\n  try {\n    await load();\n    console.log(name, "ran to its end");\n  } catch (error) {\n    console.log(name, error?.constructor?.name);\n  }\n}\n` +
        part.map(({ name }) => `await attempt("${name}", () => import("./${name}.js"));\n`).join("");
    }
  return files;
}

export const programs = () => {
  const files: Record<string, string> = initializersThatNobodyReads();
  for (const name in names)
    for (const fill in fills)
      for (const reader in readers) {
        const folder = `filled-through-${name}-by-${fill}-and-read-first-by-${reader}`;
        files[`${folder}/flags.js`] = flags;
        for (const [file, text] of Object.entries(readers[reader](name, fill))) files[`${folder}/${file}`] = text;
      }
  return programsOf(files);
};
