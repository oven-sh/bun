// Each line: where the two innermost frames stand when an error is thrown in a field, a key, a default or a statement of each kind, behind values that Bun's transpiler computes.
function show(f) { try { console.log(f.name, String(f(0))); } catch (error) { console.log(f.name, error.name, String(error.stack).split("\n").slice(1, 3).map(line => line.replace(/.*:(\d+:\d+)\)?$/, "$1")).join(" ")); } }
const five = 5;
const text = "t";
const nothing = undefined;
function pass(value) { return value; }
show(function field() { class C { x = five(); } return new C(); });
show(function fieldFolded() { class C { x = (five + 1)(); } return new C(); });
show(function fieldJoined() { class C { x = (text + "a")(); } return new C(); });
show(function fieldBehindAComma() { class C { x = (0, pass)(1)(); } return new C(); });
show(function fieldOfALocal() { const six = 6; class C { x = six(); } return new C(); });
show(function fieldChosen() { class C { x = (five ? nothing : 1).p; } return new C(); });
show(function fieldLogical() { class C { x = (0 || nothing).p; } return new C(); });
show(function staticField() { class C { static x = (five + 1)(); } return C; });
show(function staticFieldMember() { class C { static x = nothing.p; } return C; });
show(function staticBlock() { class C { static { (five + 1)(); } } return C; });
show(function staticBlockUsedOnce() { class C { static { const r = pass(1); r(); } } return C; });
show(function computedKey() { class C { [(five + 1)()]() {} } return C; });
show(function computedKeyOfAField() { class C { [nothing.p] = 1; } return C; });
show(function computedKeyJoined() { class C { ["a" + text]() { return nothing.p; } } return new C().at(); });
show(function privateField() { class C { #x = (five + 1)(); } return new C(); });
show(function accessorBody() { class C { get x() { const r = five + 1; return r(); } } return new C().x; });
show(function methodDefault() { class C { m(a = (five + 1)()) {} } return new C().m(); });
show(function constructorDefault() { class C { constructor(a = nothing.p) {} } return new C(); });
show(function heritageFolded() { class C extends (five + 1) {} return C; });
show(function heritageChosen() { class C extends (five ? nothing : 1) {} return C; });
show(function heritageCall() { class C extends (0, pass)(1) {} return C; });
show(function heritageOfALocal() { const six = 6; class C extends six {} return C; });
show(function classExpressionField() { const C = class { x = (five + 1)(); }; return new C(); });
show(function classExpressionStatic() { return class { static x = (text + "a")(); }; });
show(function objectMethodDefault() { return { m(a = (five + 1)()) {} }.m(); });
show(function objectComputedKey() { return { [(five + 1)()]: 1 }; });
show(function objectGetter() { return { get x() { return (five + 1)(); } }.x; });
show(function arrowDefault() { return ((a = (five + 1)()) => a)(); });
show(function templateHole() { return `${(five + 1)()}`; });
show(function taggedTemplate() { return (five + 1)`a`; });
show(function spreadOfAFold() { return [...(five + 1)]; });
show(function newOfAFold() { return new (five + 1)(); });
show(function inOfAFold() { return 1 in (five + 1); });
show(function instanceofAFold() { return 1 instanceof (five + 1); });
show(function awaitInAsync() { return (async () => { await 0; })() && (five + 1)(); });
show(function labelAndLoop() { out: for (const a of [1]) { (five + a)(); } });
show(function switchCase(n) { switch (n) { case five - 5: return (five + 1)(); } });
show(function tryFinally() { try { return 1; } finally { (five + 1)(); } });
show(function catchBody() { try { throw 1; } catch { (five + 1)(); } });
show(function forInit() { for (let i = (five + 1)(); ; ) return i; });
show(function forUpdate() { for (let i = 0; ; (five + 1)()) { if (i++) return; } });
show(function whileTest() { while ((five + 1)()) return; });
show(function doWhileTest() { do {} while ((five + 1)()); });
show(function ifTest() { if ((five + 1)()) return; });
show(function throwOfAFold() { throw (five + 1)(); });
show(function fieldFoldedFromALocal() { const six = 6; class C { x = (six + 1)(); } return new C(); });
show(function fieldJoinedFromALocal() { const word = "w"; class C { x = (word + "a")(); } return new C(); });
show(function fieldChosenByALocal() { const six = 6; class C { x = (six ? undefined : 1).p; } return new C(); });
show(function fieldBehindADroppedOperand() { const six = 6; class C { x = (six, pass)(1)(); } return new C(); });
show(function staticFieldFoldedFromALocal() { const six = 6; class C { static x = (six + 1)(); } return C; });
show(function privateFieldFoldedFromALocal() { const six = 6; class C { #x = (six + 1)(); } return new C(); });
show(function heritageFoldedFromALocal() { const six = 6; class C extends (six + 1) {} return C; });
show(function heritageBehindADroppedOperand() { const six = 6; class C extends (six, pass)(1) {} return C; });
show(function heritageOfAnExpression() { const six = 6; return class extends (six && pass)(1) {}; });
show(function fieldOverLines() { const six = 6; class C {
  x =
    (six +
      1)();
} return new C(); });
show(function fieldWithAStringName() { const six = 6; class C { "a b" = (six + 1)(); } return new C(); });
show(function fieldWithANumberName() { const six = 6; class C { 7 = (six + 1)(); } return new C(); });
