// RUN: lower
// OPTIONS: builtin-modules

// Calls of functions that were given another prototype, or none, with `Object.setPrototypeOf`.
declare const console: any;
const log: any[] = [];
function attempt(what: string, run: () => any) { try { log.push(what + ": " + String(run())); } catch (e: any) { log.push(what + " throws " + e.constructor.name); } }
const none: any = function (this: any) { return "none " + String(this); };
const two: any = function (this: any, a: any, b: any) { return "two " + String(a) + String(b); };
const rest: any = function (this: any, a: any, ...r: any[]) { return "rest " + String(a) + " " + r.length + ":" + r.join(""); };
const arrow: any = (a: any) => "arrow " + String(a);
let captured = 5; const capturing: any = (a: any) => "capturing " + (captured + a);
const typed = (a: number, b: number): number => a * 10 + b;
// `typed` is only ever called with two numbers: an argument of another kind throws a TypeError on entry.
const closures: any[] = [none, two, rest, arrow, capturing];
function callTyped(f: (a: number, b: number) => number, a: number): number { return f(a, 1) + 1; }
const other = { marker: "other", call: Function.prototype.call, apply: Function.prototype.apply };
for (const [label, change] of [["as made", (f: any) => f], ["another prototype", (f: any) => Object.setPrototypeOf(f, other)], ["no prototype", (f: any) => Object.setPrototypeOf(f, null)], ["frozen", (f: any) => Object.freeze(f)]] as [string, (f: any) => any][]) {
  for (const f of [...closures, typed]) attempt(label + " change", () => typeof change(f));
  for (const f of closures) {
    attempt(label + " 0", () => f()); attempt(label + " 1", () => f(1)); attempt(label + " 2", () => f(1, 2)); attempt(label + " 3", () => f(1, 2, 3)); attempt(label + " 9", () => f(1, 2, 3, 4, 5, 6, 7, 8, 9));
    attempt(label + " spread", () => f(...[1, 2, 3])); attempt(label + " Reflect.apply", () => Reflect.apply(f, "t", [1, 2])); attempt(label + " method", () => ({ m: f }).m(4, 5));
    attempt(label + " .call", () => f.call("t", 1, 2)); attempt(label + " marker", () => f.marker); attempt(label + " prototype", () => Object.getPrototypeOf(f) === Function.prototype ? "Function.prototype" : Object.getPrototypeOf(f) === other ? "other" : String(Object.getPrototypeOf(f)));
    attempt(label + " typeof", () => typeof f);
  }
  attempt(label + " callTyped", () => callTyped(typed, 3)); attempt(label + " typed as any", () => (typed as any)(4, 5)); attempt(label + " typed Reflect.apply", () => Reflect.apply(typed, undefined, [6, 7]));
  let s = 0; for (let i = 0; i < 20000; i++) s += callTyped(typed, i & 7); log.push(label + " loop " + s);
}
console.log(log.join("\n"));
export {};

// GENERATED: attempt rest arrow typed
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string=": "
// CHECK-NEXT: v6 = Add v0, v5
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v1 calleeName="run"
// CHECK-NEXT: v9 = Call v7, -, v8 calleeName="String"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = Add v6, v10
// CHECK-NEXT: v12 = Call v4, v3, v11 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v13 = Convert v12 declared={type=number site=[[w_6]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="log"
// CHECK-NEXT: v17 = PropGet v16 key="push"
// CHECK-NEXT: v18 = String string=" throws "
// CHECK-NEXT: v19 = Add v0, v18
// CHECK-NEXT: v20 = PropGet v14 key="constructor"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|number|string|symbol|bigint|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="name"
// CHECK-NEXT: v23 = Add v19, v22
// CHECK-NEXT: v24 = Call v17, v16, v23 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v25 = Convert v24 declared={type=number site=[[w_8]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="rest"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, HasThis, IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}, {type=Array site=[[w_9]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = String string="rest "
// CHECK-NEXT: v4 = Builtin builtin=String
// CHECK-NEXT: v5 = Call v4, -, v1 calleeName="String"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = Add v3, v6
// CHECK-NEXT: v8 = String string=" "
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = PropGet v2 key="length"
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: v12 = Add v9, v11
// CHECK-NEXT: v13 = String string=":"
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: v15 = PropGet v2 key="join"
// CHECK-NEXT: v16 = String string=""
// CHECK-NEXT: v17 = Call v15, v2, v16 calleeKey="join" calleeName="r.join"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v19 = Add v14, v18
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="arrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="arrow "
// CHECK-NEXT: v2 = Builtin builtin=String
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = Add v1, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="typed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=number site=[[w_16]]}, {type=number site=[[w_17]]}] results=[{type=number site=[[w_18]]}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: number, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Integer integer=10
// CHECK-NEXT: v3 = Mul v0, v2
// CHECK-NEXT: v4 = Add v3, v1
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_18]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
