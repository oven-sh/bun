// RUN: lower
// OPTIONS: builtin-modules

// A direct eval is handed `this` of the function around it. In the constructor of a derived class there is none until super() has returned, and an eval ahead of it runs all the same.
class Base { constructor() { this.id = "base"; } }
function row(name, run) { try { console.log(name + ": " + String(run())); } catch (error) { console.log(name + ": THROWS " + error.name); } }
row("ahead of super()", () => new (class extends Base { constructor() { const seen = eval("1 + 1"); super(); this.seen = seen; } })().seen);
row("a variable of the eval's own", () => new (class extends Base { constructor() { eval("var x = 20"); super(); this.seen = typeof x; } })().seen);
row("a variable of the constructor", () => new (class extends Base { constructor(given) { const seen = eval("given + 1"); super(); this.seen = seen; } })(1).seen);
row("in an arrow function ahead of super()", () => new (class extends Base { constructor() { const run = () => eval("2"); const seen = run(); super(); this.seen = seen; } })().seen);
row("behind super()", () => new (class extends Base { constructor() { super(); this.seen = eval("this.id"); } })().seen);
row("in an arrow function made ahead of super() and called behind it", () => new (class extends Base { constructor() { const run = () => eval("this.id"); super(); this.seen = run(); } })().seen);
row("a class that extends nothing", () => new (class { constructor() { this.id = "own"; this.seen = eval("this.id"); } })().seen);
row("no super() at all", () => new (class extends Base { constructor() { eval("1"); } })());

// GENERATED: Base run
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="base"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v6 key="id"
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
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_3]] flags=[IsFromCompiler]}, {type=env [[L_4]] flags=[IsFromCompiler]}, {type=anything}, {type=function flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}, {type=anything}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: env [[L_3]], v1: env [[L_4]], v2: anything, v3: function, v4: object, v5: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="eval" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="2"
// CHECK-NEXT: v10 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v11 = StrictEq v8, v10
// CHECK-NEXT: Branch v11 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: v13 = GetEnvironmentField v0 layout=[[L_3]]
// CHECK-NEXT: v14 = PropGet v13 key="prototype"
// CHECK-NEXT: v15 = DirectEval v9, v12, v2, v1, v5, v3, v14, v0 evalScope=e6
// CHECK-NEXT: Jump -> next b4(v15)
// CHECK-NEXT: b3(v16):
// CHECK-NEXT: v17 = Call v16, -, v9 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v17)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_6]] flags=[IsFromCompiler]}, {type=env [[L_7]] flags=[IsFromCompiler]}, {type=anything}, {type=function flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}, {type=anything}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: env [[L_6]], v1: env [[L_7]], v2: anything, v3: function, v4: object, v5: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="eval" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="this.id"
// CHECK-NEXT: v10 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v11 = StrictEq v8, v10
// CHECK-NEXT: Branch v11 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: v13 = GetEnvironmentField v0 layout=[[L_6]]
// CHECK-NEXT: v14 = PropGet v13 key="prototype"
// CHECK-NEXT: v15 = DirectEval v9, v12, v2, v1, v5, v3, v14, v0 evalScope=e7
// CHECK-NEXT: Jump -> next b4(v15)
// CHECK-NEXT: b3(v16):
// CHECK-NEXT: v17 = Call v16, -, v9 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v17)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
