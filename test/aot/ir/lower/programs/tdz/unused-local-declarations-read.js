// RUN: lower
// OPTIONS: builtin-modules

// Each function declares a local binding that nothing reads, and most of the declarations read a let, const or class before it is initialized.
function show(f) {
  try {
    console.log(f.name, f());
  } catch (error) {
    console.log(f.name, error.name);
  }
}
function pure() {}
show(function list() { const v = [v]; return 1; });
show(function letList() { let v = [v]; return 1; });
show(function object() { const v = { a: v }; return 1; });
show(function objectKey() { const v = { [v]: 1 }; return 1; });
show(function classKey() { const v = class { [v]() {} }; return 1; });
show(function classStaticGetterKey() { const v = class { static get [v]() { return 1; } }; return 1; });
show(function classStaticField() { const v = class { static a = v; }; return 1; });
show(function classExtends() { const v = class extends v {}; return 1; });
show(function template() { const v = `${v}`; return 1; });
show(function spread() { const v = [...[v]]; return 1; });
show(function newSet() { const v = new Set([v]); return 1; });
show(function newMap() { const v = new Map([[v, 1]]); return 1; });
show(function typeOf() { const v = typeof v; return 1; });
show(function closureCalled() { const v = (() => v)(); return 1; });
show(function closureCalledInList() { const v = [(() => v)()]; return 1; });
show(function closureKept() { const v = () => v; return 1; });
show(function laterConst() { const w = [v]; const v = 1; return 1; });
show(function laterLet() { const w = [v]; let v = 1; return 1; });
show(function laterClass() { const w = [C]; class C {} return 1; });
show(function classExtendsLater() { class A extends B {} class B {} return 1; });
show(function classExtendsItself() { class A extends A {} return 1; });
show(function classOwnKey() { class A { [A]() {} } return 1; });
show(function classOwnStaticField() { class A { static a = [A]; } return 1; });
show(function block() { { const v = [v]; } return 1; });
show(function loop() { for (let i = 0; i < 2; i++) { const v = [v]; } return 1; });
show(function loopSecondTurn() { for (let i = 0; i < 2; i++) { if (i) { const w = [v]; } const v = 1; } return 1; });
show(function loopHead() { for (let i = [i]; ; ) break; return 1; });
show(function forOfHead() { for (const v of [v]) break; return 1; });
show(function forInHead() { for (const v in { v }) break; return 1; });
show(function switchSameClause() { switch (1) { case 1: const v = 1; const w = [v]; } return 1; });
show(function switchItself() { switch (1) { case 1: const v = [v]; } return 1; });
show(function tryBlock() { try { const v = [v]; } catch (error) { return "caught " + error.name; } return 1; });
show(function patternDefault() { const [a = b, b] = []; return 1; });
show(function objectPatternDefault() { const { a = b, b } = {}; return 1; });
show(function parameterDefault(a = [b], b) { return 1; });
show(function sameStatement() { const a = [b], b = 1; return 1; });
show(function behind() { const v = 1; const w = [v]; return 1; });
show(function markedCall() { const w = /* @__PURE__ */ pure(v); const v = 1; return 1; });

// CHECK-LABEL: function {{*}}name="classStaticGetterKey"
// CHECK-LABEL: function {{*}}name="newSet"
// CHECK-LABEL: function {{*}}name="patternDefault"
// CHECK-LABEL: function {{*}}name="C"
