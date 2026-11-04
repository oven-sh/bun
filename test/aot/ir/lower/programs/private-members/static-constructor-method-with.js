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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b5():
// CHECK-NEXT: v1 = Call v0 calleeName="f"
// CHECK-NEXT: v2 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v3) handler=b5():
// CHECK-NEXT: v4 = String string="F"
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b3(v5) handler=b5():
// CHECK-NEXT: v6 = NarrowByTest v1, v5
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v7, -, v6 calleeName="String"
// CHECK-NEXT: Jump -> next b4(v8)
// CHECK-NEXT: b4(v9) handler=b5():
// CHECK-NEXT: Return v9
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: v11 = String string="threw "
// CHECK-NEXT: v12 = PropGet v10 key="name"
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_1]]
// CHECK-NEXT: v2 = NewClass v1 layout=[[L_2]]
// CHECK-NEXT: v3 = NewClosure v0 function=[[f_3]]
// CHECK-NEXT: DefineMethod v2, v3 layout=[[L_2]] side=Static key="constructor"
// CHECK-NEXT: v5 = FinishClass v2 layout=[[L_2]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = Call v9, -, v1 calleeName="said"
// CHECK-NEXT: v11 = Add v8, v10
// CHECK-NEXT: v12 = Call v6, v4, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Async"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]]}
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: PropSet v3, v4 key="made"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(v3)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: Jump -> next b2(v8)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Heir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
