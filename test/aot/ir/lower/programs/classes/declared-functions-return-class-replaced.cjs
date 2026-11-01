// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS100302 2

// A declared function that returns a class is stored to, declared twice, or asks which closure runs.
var lines = [];
class Base { who() { return "base"; } }
function Replaced(Parent) { return class extends Parent { who() { return "first>" + super.who(); } }; }
var R1 = Replaced(Base), R2 = Replaced(Base);
Replaced = function (Parent) { return class extends Parent { who() { return "second>" + super.who(); } }; };
var R3 = Replaced(Base), R4 = Replaced(R1);
lines.push([new R1().who(), new R2().who(), new R3().who(), new R4().who()].join());
function Doubled(Parent) { return class extends Parent { who() { return "one"; } }; }
var D1 = Doubled(Base), D2 = Doubled(Base);
function Doubled(Parent) { return class extends Parent { who() { return "two"; } }; }
lines.push([new D1().who(), new D2().who()].join());
function Asks(Parent) { var me = arguments.callee; return class extends Parent { static me = me; }; }
var A1 = Asks(Base), A2 = Asks(Base);
lines.push([A1.me === Asks, A2.me === Asks, A1.me === A2.me].join());
function Caller(Parent) { return class extends Parent { static by = Caller.caller === null ? "null" : typeof Caller.caller; }; }
var C1 = Caller(Base), C2 = Caller(Base); lines.push([C1.by === C2.by].join());
function ThisOne(Parent) { var self = this; return class extends Parent { static self = self; }; }
var T1 = ThisOne(Base), T2 = ThisOne.call(7, Base), T3 = ThisOne(Base); lines.push([T1.self === globalThis, typeof T2.self, T3.self === T1.self].join());
if (lines.length) { function InBlock(Parent) { return class extends Parent { who() { return "block"; } }; } var B1 = InBlock(Base), B2 = InBlock(Base); lines.push([new B1().who(), B1 === B2].join()); }
globalThis.Leaked = Replaced; lines.push(new (Leaked(Base))().who());
console.log(lines.join("\n"));

// GENERATED: Asks ThisOne Base who
// CHECK-LABEL: function {{*}}name="Asks"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: function, v1: int[0, 4294967295], v2: anything, v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateMappedArguments v0, v1, v3, v2
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: v6 = PropGet v4 key="callee"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v8 = GetMappedArgument v4
// CHECK-NEXT: v9 = ResolveHeritage v8
// CHECK-NEXT: v10 = NewClosure function=[[f_2]]
// CHECK-NEXT: v11 = NewClass v10, v8, v9 layout=[[L_3]]
// CHECK-NEXT: v12 = FinishClass v11 layout=[[L_3]]
// CHECK-NEXT: v13 = Convert v12 declared={type=function flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v14 = CallDirect v7, v11, v13 function=[[f_4]]
// CHECK-NEXT: v15 = Convert v12 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ThisOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[f_5]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = ToThis v0
// CHECK-NEXT: v4 = ResolveHeritage v1
// CHECK-NEXT: v5 = NewClosure function=[[f_6]]
// CHECK-NEXT: v6 = NewClass v5, v1, v4 layout=[[L_7]]
// CHECK-NEXT: v7 = FinishClass v6 layout=[[L_7]]
// CHECK-NEXT: v8 = Convert v7 declared={type=function flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = CallDirect v3, v6, v8 function=[[f_8]]
// CHECK-NEXT: v10 = Convert v7 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_10]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="who"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="base"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="who"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] captures=[{type=function flags=[IsFromCompiler]}] thisType={type=[[L_11]] flags=[IsExpected]} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: function, v1: [[L_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = String string="first>"
// CHECK-NEXT: v3 = GetSuperBase v0 homeKind=ClassPrototype
// CHECK-NEXT: v4 = SuperGet v3, v1 key="who"
// CHECK-NEXT: v5 = Call v4, v1 calleeName="super.who"
// CHECK-NEXT: v6 = Add v2, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="who"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="two"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="who"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] captures=[{type=function flags=[IsFromCompiler]}] thisType={type=[[L_13]] flags=[IsExpected]} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: function, v1: [[L_13]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = String string="second>"
// CHECK-NEXT: v3 = GetSuperBase v0 homeKind=ClassPrototype
// CHECK-NEXT: v4 = SuperGet v3, v1 key="who"
// CHECK-NEXT: v5 = Call v4, v1 calleeName="super.who"
// CHECK-NEXT: v6 = Add v2, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="who"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="block"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
