// RUN: lower
// OPTIONS: builtin-modules

// Each variable has a plain initializer and nothing ever reads it, but something stores to it, each in another way. The right-hand sides have effects, so the stores stay and need a variable to store to.
const log = [];
function effect(name) { log.push(name); return name; }

let plain = 1;
plain = effect("a plain store");
let compound = 1;
compound += effect("a compound store").length;
let logical = null;
logical ??= effect("a logical store");
let counted = 1;
counted++;
--counted;
let inArray = 1;
[inArray] = [effect("an array pattern")];
let inObject = 1;
({ inObject } = { inObject: effect("an object pattern") });
let renamed = 1;
({ key: renamed } = { key: effect("a renamed property") });
let withDefault = 1;
({ withDefault = effect("a default in a pattern") } = {});
let restOfArray = 1;
[...restOfArray] = [effect("a rest element")];
let restOfObject = 1;
({ ...restOfObject } = { a: effect("a rest property") });
let nested = 1;
[{ deep: [nested] }] = [{ deep: [effect("a nested pattern")] }];
let inForOf = 1;
for (inForOf of [effect("a for-of head")]);
let inForIn = 1;
for (inForIn in { [effect("a for-in head")]: 1 });
let inForOfPattern = 1;
for ([inForOfPattern] of [[effect("a pattern in a for-of head")]]);
var viaVar = 1;
viaVar = effect("a store to a var");
let inFunction = 1;
function stores() { inFunction = effect("a store inside a function"); }
stores();
let inArrow = 1;
(() => (inArrow = effect("a store inside an arrow function")))();
let inClass = 1;
class Storer { static { inClass = effect("a store inside a static block"); } }
let chained = 1, alsoChained = 1;
chained = alsoChained = effect("a chained store");

console.log(log.join("\n"));

// GENERATED: effect stores Storer
// CHECK-LABEL: function {{*}}name="effect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v4, v2, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="stores"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="inFunction"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = String string="a store inside a function"
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="effect"
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_3]]
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Storer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
