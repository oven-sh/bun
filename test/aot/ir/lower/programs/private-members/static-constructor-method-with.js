// RUN: lower
// OPTIONS: builtin-modules

// A class with both a constructor and a static method named `constructor`: `new` runs the real constructor.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
let calls = 0;
class Both { constructor(v) { this.made = v; } static constructor() { calls++; return "static"; } }
class Alone { static constructor() { calls++; return "alone"; } }
class Async { constructor() { this.made = 1; } static async constructor() { return "later"; } }
class Quoted { constructor() { this.made = 2; } static "constructor"() { return "quoted"; } }
class Heir extends Both { static constructor() { return "heir " + super.constructor(); } }
row("new runs the constructor", () => new Both(5).made + " " + calls);
row("the static method", () => Both.constructor() + " " + calls);
row("it is the class's own property", () => Object.hasOwn(Both, "constructor") + " " + Object.hasOwn(Alone, "constructor"));
row("the prototype's constructor is the class", () => (Both.prototype.constructor === Both) + " " + (Alone.prototype.constructor === Alone));
row("new of a class that has only the static one", () => Object.keys(new Alone()).length + " " + calls + " " + (new Alone() instanceof Alone));
row("the static one alone", () => Alone.constructor() + " " + calls);
row("it cannot be constructed", () => new Both.constructor());
row("its name and length", () => Both.constructor.name + " " + Both.constructor.length + " " + Both.length);
row("async", () => new Async().made + " " + typeof Async.constructor().then);
row("quoted", () => new Quoted().made + " " + Quoted.constructor());
row("an heir", () => Heir.constructor() + " " + new Heir(6).made);
function make(n) { return class { constructor() { this.n = n; } static constructor() { return -n; } }; }
row("made twice", () => [new (make(1))().n, make(1).constructor(), new (make(2))().n, make(2).constructor(), make(1).constructor === make(1).constructor].join());

// GENERATED: said make row Async Heir
// CHECK-LABEL: function {{*}}name="said"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b8():
// CHECK-NEXT: v1 = Call v0 calleeName="f"
// CHECK-NEXT: v2 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v2 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v3) handler=b8():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v4 = String string="F"
// CHECK-NEXT: Jump -> next b7(v4)
// CHECK-NEXT: b5(v5) handler=b8():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b8():
// CHECK-NEXT: v6 = Builtin builtin=String
// CHECK-NEXT: v7 = Call v6, -, v5 calleeName="String"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v8)
// CHECK-NEXT: b7(v9) handler=b8():
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: b8() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = String string="threw "
// CHECK-NEXT: v13 = PropGet v11 key="name"
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_2]]
// CHECK-NEXT: v2 = NewClass v1 layout=[[L_3]]
// CHECK-NEXT: v3 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: DefineMethod v2, v3 layout=[[L_3]] side=Static key="constructor"
// CHECK-NEXT: v5 = FinishClass v2 layout=[[L_3]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v10 = Call v9, -, v1 calleeName="said"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Async"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v6 key="made"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Heir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
