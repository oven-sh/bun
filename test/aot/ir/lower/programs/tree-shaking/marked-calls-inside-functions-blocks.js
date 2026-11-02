// RUN: lower
// OPTIONS: builtin-modules

// A mark before a call lets it go when its result is not used, and both `bun run` and `bun build --compile` decide that while they parse, wherever the call stands: a marked call that is a statement of its own goes, in a function, a method, a static block, an arm, a loop, try, finally and a block; so does the left of a comma, an element of an array that is a statement, the operand of void and of !, an arm of ?: in a statement. A constant inside a function or a block keeps its marked call, and so does the left of &&.
const log = [];
function make(name) { log.push(name); return { name }; }
class Made { constructor(name) { log.push("new " + name); } }
function inFunction() { /* @__PURE__ */ make("a statement in a function"); const unused = /* @__PURE__ */ make("a constant in a function"); return 1; }
const inArrow = () => { /* @__PURE__ */ make("a statement in an arrow function"); };
class Holder { method() { /* @__PURE__ */ new Made("a statement in a method"); } static { /* @__PURE__ */ make("a statement in a static block"); } }
inFunction();
inArrow();
new Holder().method();
if (log.length >= 0) { /* @__PURE__ */ make("a statement in an arm"); }
for (let i = 0; i < 1; i++) { /* @__PURE__ */ make("a statement in a loop"); }
try { /* @__PURE__ */ make("a statement in try"); } finally { /* @__PURE__ */ make("a statement in finally"); }
{ /* @__PURE__ */ make("a statement in a block"); const unused = /* @__PURE__ */ make("a constant in a block"); }
(/* @__PURE__ */ make("the left of a comma"), log.push("the right of a comma"));
[/* @__PURE__ */ make("an element beside a call"), log.push("the call beside it")];
void /* @__PURE__ */ make("under void");
!/* @__PURE__ */ make("under !");
/* @__PURE__ */ make("an operand of &&") && log.push("the right of &&");
log.length ? /* @__PURE__ */ make("an arm of ?: in a statement") : 0;
console.log(log.join("\n"));

// GENERATED: make inFunction Made inArrow Holder method
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v4, v2, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = NewObject -, v0 layout=[[L_1]] fields=[0]
// CHECK-NEXT: v7 = FinishObject v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = String string="a constant in a function"
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="make"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Made"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_5]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="log"
// CHECK-NEXT: v7 = PropGet v6 key="push"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="new "
// CHECK-NEXT: v10 = Add v9, v1
// CHECK-NEXT: v11 = Call v8, v6, v10 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: v13 = TypeTest v12 testedType=object
// CHECK-NEXT: Branch v13 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: Jump -> next b4(v14)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inArrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
