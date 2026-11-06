// RUN: lower
// OPTIONS: builtin-modules

// What a species constructor of the program has made is written by the built-in that asked for it.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const seen = [];
class Splitter { lastIndex = { qa: 1 }; exec(s) { seen.push(attempt(() => this.lastIndex.qa) + ":" + typeof this.lastIndex); return null; } }
const r = /,/; r.constructor = { [Symbol.species]: Splitter };
console.log("a,b".split(r).length, seen.join("|"));
seen.length = 0;
const r2 = /,/g; r2.constructor = { [Symbol.species]: Splitter };
console.log([..."a,b".matchAll(r2)].length, seen.join("|"));
console.log(attempt(() => new Splitter().lastIndex.qa));
class Cap { constructor(ex) { ex(v => { this.got = v; }, () => {}); } got = { qa: 2 }; }
const c = Promise.resolve.call(Cap, 5); console.log(c instanceof Cap, attempt(() => c.got.qa), typeof c.got);

// GENERATED: attempt Splitter exec Cap
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Call v0 calleeName="f"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: v4 = String string="threw "
// CHECK-NEXT: v5 = PropGet v3 key="constructor"
// CHECK-NEXT: v6 = PropGet v5 key="name"
// CHECK-NEXT: v7 = Add v4, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Splitter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="exec"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=null flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="seen"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v7 = NewClosure v0 function=[[f_6]]
// CHECK-NEXT: v8 = Call v6, -, v7 calleeName="attempt"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v10 = String string=":"
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="lastIndex"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v15 = TypeOf v14
// CHECK-NEXT: v16 = Add v11, v15
// CHECK-NEXT: v17 = Call v5, v3, v16 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v18 = Null
// CHECK-NEXT: v19 = Convert v18 declared={type=null flags=[IsExpected]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Cap"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_8]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_9]]
// CHECK-NEXT: v6 = NewClosure v4 function=[[f_10]]
// CHECK-NEXT: v7 = NewClosure function=[[f_11]]
// CHECK-NEXT: v8 = Call v1, -, v6, v7 calleeName="ex"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
