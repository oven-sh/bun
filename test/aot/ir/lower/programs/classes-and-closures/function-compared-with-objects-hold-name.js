// RUN: lower
// OPTIONS: builtin-modules

// A function is compared with what objects hold under its name: itself, a bound copy, another function of that name, nothing, a proxy. And closures of one function, methods and static methods with each other.
function emit() { return 1; }
const a = { emit };
function same(o) { return o.emit === emit; }
console.log(same(a), same({ emit: emit.bind(null) }), same({ emit: function emit() {} }), same({}), same({ emit: new Proxy(emit, {}) }));
function make() { return function inner() {}; }
const i1 = make(); function isI1(x) { return x === i1; }
console.log(isI1(i1), isI1(make()), isI1(null));
function once() { return function single() { return 2; }; }
const s1 = once(); console.log(s1 === s1, [s1].includes(s1), s1 === once());
class K { m() {} static s() {} }
console.log(new K().m === K.prototype.m, new K().m === new K().m, K.s === K.s, (() => {}) === (() => {}));

// GENERATED: same make isI1 K m single
// CHECK-LABEL: function {{*}}name="same"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="emit"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = StrictEq v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[f_3]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_4]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isI1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_3]] flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="i1"
// CHECK-NEXT: v3 = StrictEq v0, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="K"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="single"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
