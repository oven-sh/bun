// Functions that name themselves in code that is dropped.
function show(f) {
  try {
    console.log(f.name, String(f(1)));
  } catch (error) {
    console.log(f.name, error.name, String(error.stack).split("\n").slice(1, 3).map(line => line.replace(/.*:(\d+:\d+)\)?$/, "$1")).join(" "));
  }
}
function thrower() { throw new Error("thrown"); }
show(function namesItselfInAnUnusedStatement() { function f() { "v" > f ? "v" : f; } async () => { return f; }; return typeof f; });
show(function namesItselfAlone() { function f() { f; } return typeof f; });
show(function namesItselfInABlock() { { function f() { f; } return typeof f; } });
show(function namesItselfInABlockAndIsCalledOnce() { { function f() { 0 && f; thrower(); } return f(); } });
show(function twoNameEachOther() { function a() { b; } function b() { a; } return typeof a + typeof b; });
show(function twoNameEachOtherInABlock() { { function a() { 0 && b; thrower(); } function b() { 0 && a; return a(); } return b(); } });
show(function threeInARing() { { function a() { 0 && c; thrower(); } function b() { 0 && a; return a(); } function c() { 0 && b; return b(); } return c(); } });
show(function usedInFrontOfTheDeclaration() { { return f(); function f() { thrower(); } } });
show(function usedInFrontAndNamesItself() { { return f(); function f() { 0 && f; thrower(); } } });
show(function declaredTwiceAndNamesItself() { { function f() { return 1; } function f() { 0 && f; thrower(); } return f(); } });
show(function aVariableAndAFunction() { { const a = 0 && f; function f() { 0 && a; thrower(); } return f(); } });
show(function aVariableHoldsTheFunction() { { function f() { 0 && g; thrower(); } const g = f; return g(); } });
show(function anArrowNamesItsVariable() { const f = () => { 0 && f; thrower(); }; return f(); });
show(function aFunctionExpressionNamesItself() { const f = function g() { 0 && g; 0 && f; thrower(); }; return f(); });
show(function aClassNamesItself() { class C { m() { 0 && C; thrower(); } } return new C().m(); });
show(function aClassExpressionNamesItsVariable() { const C = class { m() { 0 && C; thrower(); } }; return new C().m(); });
show(function aGeneratorNamesItself() { { function* f() { 0 && f; thrower(); } return f().next(); } });
show(function anAsyncFunctionNamesItself() { { async function f() { 0 && f; } return typeof f(); } });
show(function inASwitch(n) { switch (n) { case 1: function f() { 0 && f; thrower(); } return f(); } });
show(function inALabel() { out: { function f() { 0 && f; thrower(); } return f(); } });
show(function inAnIf(n) { if (n) { function f() { 0 && f; thrower(); } return f(); } });
function top() { "v" > top ? "v" : top; }
async () => { return top; };
console.log(typeof top);
