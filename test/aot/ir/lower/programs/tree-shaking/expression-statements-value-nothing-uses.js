// RUN: lower
// OPTIONS: builtin-modules

// Statements that compute something and drop it. Reading a member can run a getter or a trap, naming a variable can throw, an operator can convert an object, and a function that is called on the spot runs. `bun run` and `bun build --compile` print the same.
const log = [];
function effect(name) { log.push(name); return name; }
const source = { get getter() { return effect("a getter"); }, plain: 1 };
const trapped = new Proxy({}, { get(target, key) { return effect("a get trap for " + String(key)); } });
const converts = { valueOf() { effect("valueOf"); return 1; }, toString() { effect("toString"); return "s"; } };

source.getter;
source.plain;
source["getter"];
source?.getter;
trapped.anything;
trapped[effect("a computed key")];
+converts;
`${converts}`;
converts + 1;
converts == 1;
converts < 2;
-converts;
!converts;
typeof converts;
void effect("the operand of void");
(() => effect("a function called on the spot"))();
(function () { effect("an old-style one"); })();
new (class { constructor() { effect("a constructor"); } })();
[effect("an element")];
({ key: effect("a value") });
effect("the left of a comma"), 1;
true && effect("the right of &&");
false || effect("the right of ||");
null ?? effect("the right of ??");
try {
  notDeclaredAnywhere;
} catch (error) {
  log.push(error.name + " for a name that is not declared");
}
typeof notDeclaredAnywhere;
try {
  null.member;
} catch (error) {
  log.push(error.name + " for a member of null");
}
1;
"text";
source;

console.log(log.join("\n"));

// GENERATED: effect getter get valueOf
// CHECK-LABEL: function {{*}}name="effect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = String string="a getter"
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="effect"
// CHECK-NEXT: ReturnCall v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|symbol):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = String string="a get trap for "
// CHECK-NEXT: v4 = Builtin builtin=String
// CHECK-NEXT: v5 = Call v4, -, v1 calleeName="String"
// CHECK-NEXT: v6 = Add v3, v5
// CHECK-NEXT: v7 = Call v2, -, v6 calleeName="effect"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = String string="valueOf"
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="effect"
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
