// RUN: lower
// OPTIONS: builtin-modules

// Comments that TypeScript's JSDoc grammar does not take say nothing about the code around them.

/**
 * @param {http.IncomingMessage}
 * @param {String|Array} types...
 * @param {...*} arguments... - any number
 * @param {Mixed} ...
 * @return {Boolean|} whether
 */
function documented(first) { return first; }

/** @type {{a: } */
var brokenType = 1;

/** @typedef {Object} */
/** @typedef {{a: number,} Broken~Name */
/** @callback */
/** @template */
/** @template {string T */
function generic(value) { return value; }

/** @import { nothing from "./no-such-file.js" */
/** @import */
/** @overload
 * @param {
 */
/** @this { */
function withThis() { return typeof this; }

/** @enum { */
var Kind = { A: 1, B: 2 };

/** @extends {Array< */
class Documented extends Array {
  /** @type { */
  field = 1;
  /** @param {string */
  method(a) { return a; }
  /** @private @readonly @override @type {number */
  other = 2;
}

var cast = /** @type {string| */ (brokenType);
var satisfied = /** @satisfies { */ ({ a: 1 });
var fn = /** @param {(} a */ (a) => a, obj = { /** @type {[} */ p: 1, /** @param { */ m(a) { return a } };
var out = [];
function show(name, value) { out.push(name + ": " + (typeof value === "string" ? JSON.stringify(value) : String(value))); }

// numbers and strings of sloppy code
show("legacy octal", 010 + 0777);
show("decimal with a leading zero", 089 + 08.5);
show("octal escape", "\07\0".length + ":" + "\0");
show("eight and nine", "\8\9");
show("line continuation", "a\
b");
show("separators", 1_000 + 0x1_0 + 0b1_1 + 0o1_7);
show("dots", 1..toString() + 1.0.toFixed(1) + .5e1);
show("bigint", 0x10n + 0b11n + 0o7n + 1_0n);

// names that are keywords elsewhere
var let_ = (function () { var let = 1, yield = 2, await = 3, async = 4, of = 5, get = 6, set = 7, static = 8, implements = 9, interface = 10, package = 11; return let + yield + await + async + of + get + set + static + implements + interface + package; })();
show("names", let_);
var abc = 5; show("escaped name", abc + \u{61}bc);
var o = { get: 1, set: 2, async: 3, await: 4, static: 5, new: 6, class: 7, function: 8, get get() { return 9; }, set set(v) { this.s = v; }, async async() { return 1; }, *gen() { yield 1; }, async *ag() {}, "quoted": 10, 0x10: 11, 1e3: 12, [`t`]: 13, __proto__: { inherited: 14 } };
o.set = 3;
show("keys", Object.keys(o).join() + "|" + o.get + "|" + o.s + "|" + o.inherited);
show("duplicate keys", ({ a: 1, a: 2, "a": 3 }).a);

// semicolons that are not written
var a = 1, b = 2, c = 3
a = b
++c
show("asi", a + "," + b + "," + c)
var f = function () { return 4 }
;(function () { a = 10 })()
show("asi call", a + f())
function early() { return
  5 }
show("asi return", early())
var i = 0; do i++; while (i < 3) show("do while", i)
l1: for (var j = 0; j < 3; j++) { l2: for (;;) { if (j == 1) continue l1; break l2 } }
show("labels", j);

// html-like comments
var k = 5; var m = k --> 0; show("arrow-like", m + "," + k);

// regular expressions against division
var g = 4, x = 8;
show("division", x / g / 2);
show("regex", /[/\]]+/g.test("/]") + "," + "a/b".split(/\//).length + "," + /=/.source + "," + (x /= 2));
show("regex after paren", (function () { if (x) /re/.test("re"); return x++ / 2 })());
show("regex flags", /a/dgimsuy.flags + /\p{L}/v.flags + /(?<n>a)\k<n>/.exec("aa").groups.n + /\k/.test("k") + /\1(a)/.test("a") + /{/.test("{") + /a{,2}/.test("a{,2}") + /[\b]/.test("\b") + /\c/.test("\\c"));

// with, arguments, delete
with ({ w: 6, a: 7 }) { show("with", w + a); var fromWith = w }
show("var in with", fromWith);
function mapped(p, q) { arguments[0] = 9; q = 8; return p + "," + arguments[1] + "," + arguments.length }
show("mapped arguments", mapped(1, 2, 3));
var d = 1; show("delete a name", delete d); undeclared = 4; show("delete an implicit global", delete undeclared);
show("this of a sloppy call", (function () { return typeof this })());
show("caller", (function () { return typeof arguments.callee })());
function assigned() { assigned = 1; return typeof assigned } show("assign to own name", assigned());
var named = function inner() { inner = 2; return typeof inner }; show("assign to the name of an expression", named());
try { eval_ = undefined } catch (e) {} show("catch var", (function () { try { throw 1 } catch (e) { var e = 2 } return e })());
for (var init = 3 in {}) ; show("initializer in for-in", init);

// expressions
show("exponent", 2 ** 3 ** 2 + (-2) ** 2);
show("nullish", (null ?? 1) + (0 || 2) + (a?.b?.[0]?.() ?? 3));
show("comma", (1, 2, 3));
show("in", ("a" in { a: 1 }) + "," + (function () { for (var z = ("a" in {}) ? 1 : 2; z < 0;) ; return z })());
show("new", new (function () { this.v = 1 })().v + new Date(0).getTime() + (new (class { static s = 2 })).constructor.s + typeof new Object);
show("template", `a${1}${`b${2}`}\n\u{41}\x41` + String.raw`\n${1}\u` + (s => s.raw[0] + s[0])`\unicode`);
show("arrows", ((a, b = 2, ...c) => a + b + c.length)(1) + (async => async)(1) + (async (x) => x).name.length + ((a) => ({}))().constructor.name);
show("conditional with arrows", (true ? (a) => 1 : (b) => 2)() + (false ? a => 1 : (b) => (2))());
show("spread", [...[1, 2], , 3,].length + Math.max(...[1, 5], 2) + Object.keys({ ...{ a: 1 }, b: 2 }).length);
show("destructuring", (function ({ a = 1, b: { c = 2 } = {}, ...r } = {}, [p, , q = 3, ...s] = [4]) { return a + c + p + q + s.length + Object.keys(r).length })());
show("assignment targets", (function () { var t = {}, u; [t.a, t["b"], u = 3] = [1, 2]; ({ x: t.c, y: u = 4 } = { x: 5 }); return t.a + t.b + t.c + u })());
show("logical assignment", (function () { var p = null, q = 0, r = 1; p ??= 1; q ||= 2; r &&= 3; return p + q + r })());
show("typeof void delete", typeof void 0 + typeof typeof 1 + !-+~1);
show("increments", (function () { var n = 1; return n++ + ++n + n-- - --n })());
show("optional call", (function () { var t = { f() { return this === t } }; return t.f?.() + "," + (t?.f)() + "," + t?.["f"]() + "," + t.g?.().h })());

// classes
class A { #p = 1; static #s = 2; static { A.t = A.#s } get p() { return this.#p } static has(o) { return #p in o } 'quoted'() { return 3 } 42() { return 4 } [`c`]() { return 5 } static async *gen() {} static static() { return 6 } get() { return 7 } set(v) { return 8 } async() { return 9 } field = this.p + 1; static = 10; accessor_ = 11; ; }
var ai = new A;
show("class", [ai.p, A.t, A.has(ai), A.has({}), ai.quoted(), ai[42](), ai.c(), A.static(), ai.get(), ai.set(), ai.async(), ai.field, ai.static, ai.accessor_].join());
class B extends (0, A) { constructor() { super(); this.q = super.p + new.target.name } } show("derived", new B().q);
show("class expression", (class N { static n = N.name }).n + (class { static name = "own" }).name + (class extends null {}).name.length);
function* gen() { var r = yield 1; yield* [r, 2]; return 3 } var it = gen(); show("generator", [it.next().value, it.next(5).value, it.next().value, it.next().value].join());
show("switch", (function (v) { switch (v) { default: return "d"; case 1: { let v = 2; return v } case 2: } return "e" })(2));
show("try", (function () { try { return 1 } finally { out.push("finally") } })() + (function () { l: try { return 1 } finally { break l } return 2 })());
show("getter on a number", (1).constructor.name + 1..constructor.name + 1.["constructor"].name);
debugger;
console.log(out.join("\n"));

/** @param {string|} last */
console.log([documented(1), brokenType, generic(2), withThis(), Kind.B, new Documented().field, new Documented().method(3), new Documented().other, cast, satisfied.a, fn(4), obj.p, obj.m(5)].join());
/** @type { */

// GENERATED: mapped assigned Documented ag p has c N
// CHECK-LABEL: function {{*}}name="mapped"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: function, v1: int[0, 4294967295], v2: anything, v3: anything, v4: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = CreateMappedArguments v0, v1, v4, v2, v3
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = Integer integer=9
// CHECK-NEXT: ElemSet v5, v6, v7 mode=Sloppy
// CHECK-NEXT: v9 = Integer integer=8
// CHECK-NEXT: SetMappedArgument v5, v9 index=1
// CHECK-NEXT: v11 = GetMappedArgument v5
// CHECK-NEXT: v12 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v13 = String string=","
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: v16 = ElemGet v5, v15
// CHECK-NEXT: v17 = Add v14, v16
// CHECK-NEXT: v18 = String string=","
// CHECK-NEXT: v19 = Add v17, v18
// CHECK-NEXT: v20 = PropGet v5 key="length"
// CHECK-NEXT: v21 = Convert v20 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v22 = Add v19, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="assigned"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: PutEnvironmentField v0, v1 layout=[[L_1]]
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v4 = TypeOf v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Documented"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_4]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, IsGenerator, IsSloppy, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|AsyncGenerator<never> flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ToThis v0
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="p"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=[[L_6]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: classtoken, v1: [[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v3 = PrivateGet v2, v0 layout=[[L_6]] field=1
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: classtoken, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PrivateHas v1, v0 layout=[[L_6]] field=1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName, IsNamedByComputedKey] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=5
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="N"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
