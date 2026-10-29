// RUN: lower
// OPTIONS: builtin-modules

// `Object.assign` is an ordinary call: its getters, setters and order of evaluation are observable.
declare const console: any;
const show = (o: any) => JSON.stringify([Object.keys(o), Object.getOwnPropertyNames(o), Object.getPrototypeOf(o) === Object.prototype, o]);
console.log("defineProperties", show(Object.defineProperties({ a: 1 }, { b: { value: 2, enumerable: true } })));
console.log("defineProperties hidden", show(Object.defineProperties({ a: 1 }, { b: { value: 2 } })));
console.log("setPrototypeOf", show(Object.setPrototypeOf({ a: 1 }, { b: 2 })));
console.log("defineProperty", show(Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: true })));
console.log("assign", show(Object.assign({ a: 1 }, { b: 2 })));
interface P { x: number }
const laid: P = { x: 5 };
console.log("assign laid", show(Object.assign({ a: 1 }, laid)));
console.log("setPrototypeOf laid", show(Object.setPrototypeOf({ a: 1 }, laid)));
const proto: { v: number } = JSON.parse('{"__proto__": {"inherited": 1}, "v": 2}');
const got = Object.assign({ a: 1 }, proto);
console.log("__proto__", Object.getOwnPropertyNames(got).join(), (got as any).inherited, Object.getPrototypeOf(got) === Object.prototype);
let n = 0;
const r = (n++, Object).assign({ a: 1 }, { b: 2 });
console.log("receiver", n, show(r));
const mine: typeof Object.assign = ((target: any) => target) as any;
console.log("mine", show(mine({ a: 1 }, { b: 2 })));
const order: string[] = [];
const o2 = Object.assign({ a: (order.push("a"), 1) }, (order.push("s1"), { b: 2 }), { c: (order.push("c"), 3) });
console.log("order", order.join(), show(o2));
const withGetter = { get g() { order.push("get"); return 7; } };
console.log("getter source", show(Object.assign({ a: 1 }, withGetter)), order.join());

// GENERATED: show g
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="stringify"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v6 = Call v5, v4, v0 calleeName="Object.keys"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Builtin builtin=ObjectGetOwnPropertyNames
// CHECK-NEXT: v10 = Call v9, v8, v0 calleeName="Object.getOwnPropertyNames"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array<undefined|null|string> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = Builtin builtin=Object
// CHECK-NEXT: v13 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v14 = Call v13, v12, v0 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v15 = Builtin builtin=ObjectPrototype
// CHECK-NEXT: v16 = StrictEq v14, v15
// CHECK-NEXT: v17 = NewArray v7, v11, v16, v0 contents=anything
// CHECK-NEXT: v18 = Call v3, v1, v17 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v18 casts=[{declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_6]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="order"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = String string="get"
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="push" calleeName="order.push"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_8]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Integer integer=7
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
