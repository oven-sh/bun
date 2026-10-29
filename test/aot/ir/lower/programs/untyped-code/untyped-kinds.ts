// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// What a variable in a JavaScript file holds is inferred where the source shows it, and the program behaves the same where it does not.
import * as k from "./untyped/kinds.js"
const show = (name: string, f: () => unknown) => {
  let text: string
  try { const v = f(); text = typeof v + " " + (Object.is(v, -0) ? "-0" : String(v)) } catch (e) { text = "throws " + (e as Error).constructor.name }
  console.log(name + ": " + text)
}
const any = k as any
const given: [string, unknown[][]][] = [
  ["counter", [[5], [0], [2.5], ["3"], [NaN], [undefined]]],
  ["down", [[["a", "b", "c"]], ["xyz"], [{ length: 2, 0: "p", 1: "q" }], [{ length: "2", 0: "p", 1: "q" }]]],
  ["incremented", [[1], [1n], ["4"], [undefined], [{ valueOf() { return 9n } }]]],
  ["mixes", [[false], [true]]],
  ["blankNeverRead", [[true], [false]]],
  ["blankString", [[true], [false]]],
  ["blankBigint", [[true], [false]]],
  ["blankSymbol", [[true], [false]]],
  ["blankStringCaptured", [[true], [false]]],
  ["hoistedStringNeverRead", [[true], [false]]],
  ["concatenated", [[1], ["a"], [null], [{ toString() { return "obj" } }], [Symbol.iterator]]],
  ["addedTo", [[1], ["a"], [1n], [null], [undefined], [[1, 2]]]],
  ["lowBit", [[3], ["3"], [3n], [null], [{ valueOf() { return 5 } }], [{ valueOf() { return 5n } }]]],
  ["unsigned", [[-1], ["7"], [1n]]],
  ["negated", [[1], [0], [1n], ["2"], [{ valueOf() { return 3n } }]]],
  ["flipped", [[1], [1n], ["2"]]],
  ["plus", [["3"], [1n], [null], [undefined]]],
  ["either", [[true], [false]]],
  ["orUndefined", [[true], [false]]],
  ["fallsBack", [[null], ["s"], [0], [undefined]]],
  ["lengthOfUnknown", [["abc"], [[1]], [{ length: "long" }], [{}]]],
  ["fromProperty", [[{ count: 1 }], [{ count: 1n }], [{}]]],
  ["keyOfLoop", [[{ a: 1 }], [{}]]],
  ["valueOfLoop", [[["s"]], [[]]]],
  ["largest", [[3], ["4"], [{ valueOf() { return 8 } }], [1n], [undefined]]],
  ["asString", [[12], [null], [Symbol.iterator], [{ toString() { return "four" } }]]],
  ["asNumber", [["12"], [12n], [undefined], [Symbol.iterator]]],
  ["asBoolean", [[0], ["s"]]],
  ["shadowedString", [[1]]],
  ["shadowedMath", [[1]]],
  ["shadowedNaN", [["not NaN"]]],
  ["shadowedUndefined", [["defined"]]],
  ["nameOfKind", [[1], [undefined]]],
  ["removed", [[false], [true]]],
  ["template", [[1], [null], [Symbol.iterator]]],
  ["compared", [[1, 2], ["b", "a"], [1n, 2], [NaN, 1]]],
  ["eachOther", [[10], [80], [0]]],
  ["eachOtherMixed", [[0], [1], [4]]],
  ["switched", [[1], [2], [3]]],
  ["storesExported", [[1], ["s"]]],
]
const withArguments = new Set(given.map(it => it[0]))
for (const [name, calls] of given) for (const args of calls) show(name, () => any[name](...args))
for (const name of Object.keys(k).sort()) {
  if (withArguments.has(name) || typeof any[name] !== "function" || name === "yielded" || name === "awaited") continue
  show(name, () => any[name]())
}
show("bumpsTop again", () => k.bumpsTop())
show("exported", () => k.exported)
const it = any.yielded(); show("yielded", () => [it.next().value, it.next("sent").value].join())
k.awaited(Promise.resolve("later")).then((v: unknown) => show("awaited", () => v))

// FILE: untyped/kinds.js
export function counter(n) { let s = 0; for (let i = 0; i < n; i++) { s = s + (i & 1); } return s; }
export function down(list) { let out = ""; for (var i = list.length - 1; i >= 0; i--) out += list[i]; return out; }
export function incremented(n) { let i = n; i++; return i; }
export function mixes(flag) { let a = 0; if (flag) a = "x"; a++; return a; }
export function storedByClosure() { let c = 0; const set = v => { c = v; }; set("s"); return typeof c + c; }
export function hoisted() { const before = typeof v; var v = 1; return before + v; }
export function hoistedInLoop() { var out = []; for (var k = 0; k < 2; k++) { var t; out.push(String(t)); t = k; } return out.join(); }
export function blankInLoop() { const out = []; for (let k = 0; k < 2; k++) { let t; out.push(String(t)); t = k; } return out.join(); }
export function blankNeverRead(f) { let t; if (f) t = 1; else t = 2; return t + 1; }
export function pastExact() { let i = 9007199254740990; i++; i++; i++; return i; }
export function negativeZero() { let z = 0; z = z * -1; return 1 / z; }
export function fraction() { let x = 1; x = x / 2; return x; }
export function concatenated(a) { let s = ""; s += a; s += 1; return s; }
export function addedTo(a) { let s = 0; s += a; return s; }
export function lowBit(a) { const b = a & 1; return b; }
export function unsigned(a) { const u = a >>> 0; return u; }
export function negated(a) { const m = -a; return typeof m + String(m); }
export function flipped(a) { const m = ~a; return typeof m + String(m); }
export function plus(a) { const m = +a; return m; }
export function either(f) { const v = f ? 1 : 2.5; return v; }
export function orUndefined(f) { let v = f ? 1 : undefined; return v ?? "none"; }
export function fallsBack(a) { const v = a ?? 0; return v; }
export function lengths() { const list = [1, 2, 3]; let n = list.length; const s = "abc"; n += s.length; return n; }
export function lengthStored() { const list = [1]; list.length = 5; const n = list.length; return n; }
export function lengthOfUnknown(a) { const n = a.length; return n; }
function only(a, b) { return typeof a + typeof b; }
export function callsOnly() { return only(1, "x") + only(2); }
function defaulted(a = 5) { return a + 1; }
export function callsDefaulted() { return [defaulted(), defaulted(undefined), defaulted(2)].join(); }
function reassigned(a) { a = a + 1; return a; }
export function callsReassigned() { return reassigned(1) + reassigned(2.5); }
function escapes(a) { return typeof a; }
export function callsEscapes() { const f = escapes; return escapes(1) + f("s"); }
function recursive(n) { return n <= 0 ? 0 : n + recursive(n - 1); }
export function callsRecursive() { return recursive(4); }
export function compound() { let x = 1; x <<= 33; x **= 2; x %= 7; x -= 0.5; return x; }
export function stringIncremented() { let s = "5"; s++; return typeof s + s; }
export function booleanAdded() { let t = true; t += 1; return typeof t + t; }
export function fromProperty(o) { let n = 0; n = o.count; n++; return n; }
export function deadZone() { try { f(); let q = 1; function f() { return q; } return q; } catch (e) { return e.constructor.name; } }
export function outOfPattern() { let a = 0; [a] = ["s"]; return a; }
export function keyOfLoop(o) { let k = 0; for (k in o) { } return k; }
export function valueOfLoop(l) { let k = 0; for (k of l) { } return k; }
export function largest(a) { const m = Math.max(a, 1); return m; }
export function asString(a) { const s = String(a); return s.length; }
export function asNumber(a) { const n = Number(a); return n; }
export function asBoolean(a) { const b = Boolean(a); return b; }
export function shadowedString(a) { const String = x => 5; const s = String(a); return typeof s; }
export function shadowedMath(a) { const Math = { max: () => "most" }; const m = Math.max(a, 1); return m; }
export function addedToMath() { Math.named = () => "name"; const m = Math.named(); return m; }
export function made() { function C() { return [1, 2]; } const o = new C(); return o.length; }
export function madeFunction() { function C() { return () => 7; } const o = new C(); return typeof o + o(); }
export function logicalStores() { let a = 0; a ||= "x"; let b = null; b ??= 3; let c = 1; c &&= "y"; return [a, b, c].join(); }
export function postfix() { let i = 0; const old = i++; return old + "," + i; }
export function postfixOfString() { let i = "7"; const old = i++; return typeof old + old + i; }
export function postfixOfBigint() { let i = 7n; const old = i--; return typeof old + old + i; }
export function lastOfComma() { let x = (1, "s"); return x; }
export function captured() { let n = 0; const inc = () => n++; inc(); inc(); return n; }
export function capturedByTurn() { const fs = []; for (let i = 0; i < 3; i++) fs.push(() => i); return fs.map(f => f()).join(); }
export function notANumber() { let x = 0; x = NaN; x = x + 1; return x; }
export function infinite() { let x = 0; x = Infinity; return x - 1; }
export function shadowedNaN(NaN) { let x = NaN; return x; }
export function shadowedUndefined(undefined) { let x = undefined; return x; }
export function nameOfKind(a) { const t = typeof a; return t.length; }
export function removed(f) { const o = { x: 1 }; if (f) Object.freeze(o); const d = delete o.x; return d; }
export function template(a) { const t = `${a}!`; return t; }
export function bigints() { let b = 1n; b++; b = b * 2n; return typeof b + b; }
export function bigintAndNumber() { let b = 1n; try { b = b + 1; return "no error"; } catch (e) { return e.constructor.name + typeof b; } }
export function symbolAdded() { let s = 0; try { s = s + Symbol.iterator; return "no error"; } catch (e) { return e.constructor.name + s; } }
export function objectToNumber() { const o = { valueOf() { return 2n; } }; const m = o * 2n; return typeof m + m; }
export function objectToString() { const o = { toString() { return "o"; } }; let s = 1; s = s + o; return typeof s + s; }
export function compared(a, b) { const less = a < b; return less; }
export function twoVariables() { let a = 0, b = a; a = "s"; b = a; return typeof b; }
export function eachOther(n) { let a = 0, b = 1; for (let i = 0; i < n; i++) { const t = a; a = b; b = t + b; } return a; }
export function eachOtherMixed(n) { let a = 0, b = "1"; for (let i = 0; i < n; i++) { const t = a; a = b; b = t + b; } return typeof a + a; }
export function switched(k) { let r; switch (k) { case 1: r = 10; break; case 2: r = 20; break; } return r; }
export function tried() { let r = 0; try { r = 1; throw 0; } catch { r = r + 1; } finally { r = r * 10; } return r; }
export function* yielded() { let got = 0; got = yield got; return got; }
export async function awaited(p) { let got = 0; got = await p; return got; }
export function blankString(f) { let t; if (f) t = "a"; else t = "b"; return t + "!"; }
export function blankBigint(f) { let t; if (f) t = 1n; else t = 2n; return t + 1n; }
export function blankSymbol(f) { let t; if (f) t = Symbol.iterator; else t = Symbol.hasInstance; return t.description; }
export function blankStringCaptured(f) { let t; const get = () => t; if (f) t = "a"; else t = "b"; return get() + "!"; }
export function blankStringRead() { let t; const before = typeof t; t = "a"; return before + t; }
export function hoistedString() { const before = typeof v; var v = "s"; return before + v; }
export function hoistedStringNeverRead(f) { if (f) { var v = "s"; return v + "!"; } return "none"; }
export function blankStringInLoop() { const out = []; for (let k = 0; k < 2; k++) { let t; if (k) t = "x"; else t = "y"; out.push(t); } return out.join(); }
export function deadZoneOfString(f) { try { const get = () => q; get(); const q = f ? "s" : "t"; return q; } catch (e) { return e.constructor.name; } }
class Counter { #count = 0; #name = "c"; #blank; #big = 1n; #mixed = 0;
  up() { return ++this.#count; } down() { return this.#count--; } add(n) { this.#count += n; return this.#count; }
  name() { this.#name += "!"; return this.#name; } blank() { const before = this.#blank; this.#blank = 1; return typeof before + this.#blank; }
  big() { this.#big++; return this.#big; } mix(v) { this.#mixed = v; this.#mixed++; return this.#mixed; }
  static peek(other) { return other.#count; } }
export function privateFields() { const c = new Counter(); return [c.up(), c.up(), c.down(), c.add(2.5), c.name(), c.blank(), c.blank(), c.big(), c.mix(1), c.mix("4"), c.mix(4n), Counter.peek(c)].map(it => typeof it + String(it)).join(); }
export function privateFieldOfAnother() { try { return Counter.peek({}); } catch (e) { return e.constructor.name; } }
let top = 0;
export function bumpsTop() { top++; return top; }
export let exported = 0;
export function storesExported(v) { exported = v; return exported; }
var early = typeof late + typeof lateFunction;
var late = 1;
function lateFunction() { }
export function readsEarly() { return early + late; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show toString
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b10():
// CHECK-NEXT: v4 = Call v1 calleeName="f"
// CHECK-NEXT: v5 = TypeOf v4
// CHECK-NEXT: v6 = String string=" "
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Builtin builtin=ObjectIs
// CHECK-NEXT: v10 = Double number=-0
// CHECK-NEXT: v11 = Call v9, v8, v4, v10 calleeName="Object.is"
// CHECK-NEXT: v12 = Convert v11 declared={type=boolean site=[[w_6]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: Branch v13 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v14) handler=b10():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b10():
// CHECK-NEXT: v15 = String string="-0"
// CHECK-NEXT: Jump -> next b7(v15)
// CHECK-NEXT: b5(v16) handler=b10():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b10():
// CHECK-NEXT: v17 = Builtin builtin=String
// CHECK-NEXT: v18 = Call v17, -, v4 calleeName="String"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b7(v19)
// CHECK-NEXT: b7(v20) handler=b10():
// CHECK-NEXT: v21 = Add v7, v20
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b10():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: Jump -> next b11(v22)
// CHECK-NEXT: b10() role=CatchHandler:
// CHECK-NEXT: v23 = CatchValue
// CHECK-NEXT: v24 = String string="throws "
// CHECK-NEXT: v25 = Convert v23 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v26 = PropGet v25 key="constructor"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|function site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v28 = PropGet v27 key="name"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v30 = Add v24, v29
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b11(v31)
// CHECK-NEXT: b11(v32: undefined|null|string):
// CHECK-NEXT: v33 = Builtin builtin=GlobalThis
// CHECK-NEXT: v34 = PropGet v33 key="console" [isFreeName]
// CHECK-NEXT: v35 = Convert v34 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v35 key="log"
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v38 = String string=": "
// CHECK-NEXT: v39 = Add v0, v38
// CHECK-NEXT: v40 = Add v39, v32
// CHECK-NEXT: v41 = Call v37, v35, v40 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v42 = Undefined
// CHECK-NEXT: Return v42
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toString"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="obj"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toString"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="four"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
