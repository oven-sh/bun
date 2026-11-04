// RUN: lower
// OPTIONS: builtin-modules

// Syntax that TypeScript reports and JavaScript accepts, in a CommonJS module in sloppy mode. Plain Bun declares no `var` for the labeled function, so the output is stored.
module.exports = {};
var o = { x: "a property read through with" };
with (o) { console.log(x); }
var variable = 1;
console.log(delete variable, variable);
var let = "let";
var yield = "yield";
var static = "static";
var implements = "implements";
console.log(let, yield, static, implements);
a: function f() { return "a labeled function"; }
console.log(f());
b: var c = 1;
console.log(c);
console.log({ p: 1, p: 2 }.p);
console.log({ get q() { return 1; }, q: 2 }.q);
var received;
({ set r(v = 1) { received = v; } }).r = undefined;
console.log(received);
var withoutPrototype = { __proto__: null, ["__proto__"]: 1 };
console.log(Object.getPrototypeOf(withoutPrototype), Object.keys(withoutPrototype), withoutPrototype.__proto__);
console.log(class { static constructor() { return "a static method"; } }.constructor());
console.log(new (class { m() { return 1; } m() { return 2; } })().m());
for (var [k] in { ab: 1 }) console.log(k);
for (var i = 0 in {});
console.log(i);
var tests = 0;
if (tests++);
console.log(tests);
return;
console.log("after the return");

// GENERATED: q r constructor m
// CHECK-LABEL: function {{*}}name="q"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="r"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[IsSloppy, HasExplicitName] thisType={type=anything} parameters=[{type=undefined|number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|number):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3(v4)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v7 variable=[[g_1]]
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="constructor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="a static method"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
