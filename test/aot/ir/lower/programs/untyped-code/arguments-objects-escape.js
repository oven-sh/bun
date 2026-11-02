// RUN: lower
// OPTIONS: builtin-modules

// `arguments` objects of strict functions that are handed to other code: what they are, what they hold, that each is its own object, and that they can be changed, grown and kept across collections.
const show = value => JSON.stringify(value, (key, held) => typeof held === "function" ? "function" : typeof held === "symbol" ? String(held) : held === undefined ? "undefined" : typeof held === "bigint" ? held + "n" : Object.is(held, -0) ? "-0" : held);
const keep = [];
function take(list) { keep.push(list); return list; }
function out() { return take(arguments); }
function outWithParameters(a, b) { return take(arguments); }
function outFromArrow() { return (() => take(arguments))(); }
function outFromClosure() { const args = arguments; return function () { return take(args); }; }
function forwarded() { return out.apply(this, arguments); }
function appliedLater(f) { const self = this, args = arguments; return () => f.apply(self, args); }
function describe(list) {
  const callee = Object.getOwnPropertyDescriptor(list, "callee");
  let thrown = "no"; try { list.callee; } catch (e) { thrown = e.name; }
  return [Object.prototype.toString.call(list), Array.isArray(list), list.length, show(Array.prototype.slice.call(list)), Reflect.ownKeys(list).map(String).join(), show(Object.getOwnPropertyDescriptor(list, "length")),
    typeof callee.get, callee.get === callee.set, callee.enumerable, callee.configurable, thrown, list[Symbol.iterator] === Array.prototype.values, show(Object.getOwnPropertyDescriptor(list, Symbol.iterator)).replace(/"function"/, "f"),
    Object.getPrototypeOf(list) === Object.prototype, Object.isExtensible(list), show(Object.keys(list)), show([...list]), show(Object.getOwnPropertyDescriptor(list, "0") ?? null), list[list.length], -1 in list].join(" | ");
}
const lists = [[], [1], [1, 2], [1, 2, 3], [1.5, 2.5], [1, 2.5, "x"], [undefined], [null, undefined, 0, -0, NaN], ["a", { b: 1 }, [3], () => 4, Symbol.for("s"), 10n], Array.from({ length: 63 }, (_, i) => i), Array.from({ length: 64 }, (_, i) => i), Array.from({ length: 65 }, (_, i) => i), Array.from({ length: 300 }, (_, i) => i * 0.5)];
for (const list of lists) {
  for (const [name, f] of Object.entries({ out, outWithParameters, outFromArrow, forwarded })) console.log(name, list.length, describe(f(...list)));
  console.log("outFromClosure", list.length, describe(outFromClosure(...list)()));
  console.log("apply with holes", list.length, describe(out.apply(null, [, ...list, , ])));
}
console.log(show(appliedLater(function () { return Array.from(arguments); }, 1, 2)().slice(1)), out(1) !== out(1), out() !== out());
const changed = out(1, 2, 3);
changed[0] = "zero"; changed[5] = "five"; changed.length = 10; changed.extra = true; delete changed[1]; Array.prototype.push.call(changed, "pushed");
console.log(show(Array.from(changed)), changed.length, show(Object.keys(changed)), changed.extra);
const frozen = Object.freeze(out(1, 2)); try { "use strict"; frozen[0] = 9; } catch (e) { console.log(e.name); } console.log(frozen[0], Object.isFrozen(frozen));
Object.defineProperty(changed, "length", { value: 2, writable: false }); console.log(show(Array.prototype.slice.call(changed)));
const redefined = out(1, 2); Object.defineProperty(redefined, "0", { get() { return "got"; } }); redefined[Symbol.iterator] = function* () { yield "mine"; }; console.log(redefined[0], show([...redefined]), show(Array.from(redefined)));
keep.length = 0;
let sum = 0;
for (let i = 0; i < 200000; i++) { const list = out(i, "t" + i, { i }); sum += list.length + list[0]; if (i % 40000) keep.length = keep.length > 5 ? 5 : keep.length; }
(globalThis.gc ?? (() => globalThis.Bun.gc(true)))();
console.log(sum, show(keep.map(list => Array.from(list))));

// GENERATED: take outWithParameters appliedLater show get
// CHECK-LABEL: function {{*}}name="take"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="keep"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v4, v2, v0 calleeKey="push" calleeName="keep.push"
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="outWithParameters"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: int[0, 4294967295], v1: anything, v2: anything, v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateUnmappedArguments v0, v3, v1, v2
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v6 = Call v5, -, v4 calleeName="take"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|[[L_1]] flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="appliedLater"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_6]] flags=[IsExpected]}] results=[{type=undefined|null|[[f_7]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: undefined|null|[[f_6]], v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateUnmappedArguments v1, v3, v2
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v6 = NewClosure v2, v0, v5 function=[[f_8]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="stringify"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v4 = NewClosure function=[[f_10]]
// CHECK-NEXT: v5 = Call v3, v1, v0, v4 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="got"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
