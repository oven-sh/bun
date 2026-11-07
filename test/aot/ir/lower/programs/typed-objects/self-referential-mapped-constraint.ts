// RUN: lower
// OPTIONS: builtin-modules

// A type parameter can be constrained by a mapped type over itself: `F extends Selectors<F>`, as in reselect and Redux Toolkit.
type Same<T> = { [K in keyof T]: T[K] };
function count<F extends Same<F>>(table: F): number { return Object.keys(table).length; }
console.log(count({ a: 1, b: "x" }));

type Selectors<T extends Record<string, (...args: never[]) => unknown>> = { [K in keyof T]: T[K] };
function names<F extends Selectors<F>>(table: F): (keyof F)[] { return Object.keys(table) as (keyof F)[]; }
console.log(names({ one: () => 1, two: () => "2" }).join());

class Registry<F extends Same<F>> {
  constructor(public table: F) {}
  get<K extends keyof F>(key: K): F[K] { return this.table[key]; }
}
console.log(new Registry({ x: 1, y: "why" }).get("y"));

type ReadonlySame<T> = { readonly [K in keyof T]: T[K] };
function freeze<F extends ReadonlySame<F>>(table: F): F { return Object.freeze(table); }
console.log(freeze({ a: 1 }).a);

type Optional<T> = { [K in keyof T]?: T[K] };
function merge<F extends Optional<F>>(into: F, from: Optional<F>): F { return Object.assign(into, from); }
console.log(JSON.stringify(merge({ a: 1, b: 2 }, { b: 3 })));

function nested<F extends Readonly<Same<F>>>(table: F): number { return Object.keys(table).length; }
console.log(nested({ a: 1, b: 2, c: 3 }));

declare const declaredOnly: { pick: <F extends Same<F>>(table: F) => number };
console.log(typeof declaredOnly);

// GENERATED: count names freeze merge Registry get one two
// CHECK-LABEL: function {{*}}name="count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="length"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="names"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] site=[[w_6]]}] results=[{type=undefined|null|Array<undefined|null|number|string|symbol> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|Array<undefined|null|string> site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined|null|number|string|symbol> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined|null|number|string|symbol> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="freeze"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_10]] site=[[w_11]]}] results=[{type=undefined|null|[[L_10]] site=[[w_12]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectFreeze
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.freeze"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|[[L_10]] site=[[w_12]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="merge"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_13]] site=[[w_14]]}, {type=anything}] results=[{type=undefined|null|[[L_13]] site=[[w_15]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_13]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v4 = Call v3, v2, v0, v1 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_13]] site=[[w_15]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Registry"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_16]] site=[[w_17]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_16]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_18]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_18]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_18]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_19]]
// CHECK-NEXT: PropSet v4, v1 key="table"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_18]] site=[[w_20]]} parameters=[{type=undefined|null|[[L_21]] site=[[w_22]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_18]], v1: undefined|null|[[L_21]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="table"
// CHECK-NEXT: v3 = ElemGet v2, v1
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="one"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=1 site=[[w_23]]}] functionTypes={{*}}[[f_24]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=1 site=[[w_23]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="two"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|"2" site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_26]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="2"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|"2" site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
