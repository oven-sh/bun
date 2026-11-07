// Initializers that read their own variable in code that is dropped.
function show(f) {
  try {
    console.log(f.name, String(f(1)));
  } catch (error) {
    console.log(f.name, error.name, String(error.stack).split("\n").slice(1, 2).join("").replace(/.*:(\d+:\d+)\)?$/, "$1"));
  }
}
show(function eachOther() { const a = b, b = a; return a; });
show(function eachOtherInTwoStatements() { const a = b; const b = a; return b; });
show(function eachOtherDropped() { const a = 0 && b, b = 0 && a; return [a, b]; });
show(function eachOtherDroppedInTwoStatements() { const a = 0 && b; const b = 0 && a; return a + b; });
show(function eachOtherChosenAgainst() { const a = 1 ? 2 : b; const b = 1 ? 3 : a; return a + b; });
show(function threeInARing() { const a = 0 && c; const b = 0 && a; const c = 0 && b; return a + b + c; });
show(function throughAClosure() { const a = () => b; const b = () => a; return typeof a()(); });
show(function throughAClosureDropped() { const a = 0 && (() => a); return a; });
show(function throughAClosureCalledAtOnce() { const a = (() => 0 && a)(); return a; });
show(function staticFieldReadsTheClass() { class C { static self = C; static none = 0 && C; } return C.self === C; });
show(function staticFieldOfAClassExpression() { const C = class { static self = 0 && C; }; return C.self; });
show(function defaultReadsItself(n, a = a) { return a; });
show(function defaultReadsItselfDropped(n, a = 0 && a) { return a; });
show(function defaultReadsTheNext(n, a = 0 && b, b = 0 && a) { return a + b; });
show(function patternDefaultReadsItself() { const { a = a } = {}; return a; });
show(function patternDefaultDropped() { const { a = 0 && a } = {}; return a; });
show(function listPatternDefaultDropped() { const [a = 0 && a] = []; return a; });
show(function patternsReadEachOther() { const { a = 0 && b, b = 0 && a } = {}; return a + b; });
show(function letItself() { let a = 0 && a; return a; });
show(function letItselfUsedOnce() { let a = 1 ? 2 : a; return a(); });
show(function varItself() { var a = 0 && a; return a; });
show(function typeofItselfDropped() { const a = 0 && typeof a; return a; });
show(function inATemplate() { const a = `${0 && a}`; return a; });
show(function inAList() { const a = [0 && a][0]; return a; });
show(function inAnObject() { const a = { a: 0 && a }.a; return a; });
show(function behindAComma() { const a = (0 && a, 1); return a; });
show(function usedOnceBehindItself() { const a = 0 && a; const b = a; return b(); });
show(function inALoop() { for (const a = 0 && a; ; ) return a; });
show(function inASwitch(n) { switch (n) { case 1: const a = 0 && a; return a; } });
show(function functionInABlock() { { function inner() { return 0 && inner; } return inner(); } });
const top = 0 && top;
const first = 0 && second, second = 0 && first;
console.log(top, first, second);
