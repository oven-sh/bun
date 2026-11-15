// What `toString()` gives for a function is the source without the branches that never run. A `var` in such a branch still declares its name in the function.
globalThis.shadowed = "the global";
const cases = {
  inABlock: [function (a) { if (false) { var v = 1; } return v === undefined ? a : 0; }, 1],
  asTheStatement: [function (a) { if (false) var v = 1; return v === undefined ? a : 0; }, 1],
  inAnElse: [function (a) { if (true) a++; else { var v = 1; } return v === undefined ? a : 0; }, 1],
  asTheElse: [function (a) { if (true) a++; else var v = 1; return v === undefined ? a : 0; }, 1],
  inAPattern: [function (a) { if (false) { var { v, w: [x = 2, ...y], ...z } = a; } return [v, x, y, z]; }, 1],
  overAGlobal: [function () { if (false) { var shadowed = 1; } return String(shadowed); }],
  storedTo: [function () { if (false) { var kept; } kept = 5; return typeof globalThis.kept + kept; }],
  deep: [function (a) {
    if (false) {
      for (var i = 0; i < 1; i++) { var inLoop; }
      for (var k in a) ;
      for (var o of a) ;
      try { var inTry; } catch (e) { var inCatch; } finally { var inFinally; }
      switch (a) { case 1: var inCase; }
      label: { var inLabel; }
      while (a) var inWhile;
      do { var inDo; } while (a);
      if (a) { var inIf; } else { var inElse; }
    }
    return [i, inLoop, k, o, inTry, inCatch, inFinally, inCase, inLabel, inWhile, inDo, inIf, inElse];
  }, 1],
  notOutOfAFunction: [function () { if (false) { (function () { var inner; }); const arrow = () => { var inner; }; } return typeof inner; }],
  notALet: [function () { if (false) { let inner; const other = 1; class Third {} } return [typeof inner, typeof other, typeof Third]; }],
};
const show = (run) => {
  try {
    return JSON.stringify(run()) ?? "undefined";
  } catch (error) {
    return error.constructor.name;
  }
};
for (const [name, [f, ...given]] of Object.entries(cases)) {
  const again = new Function("return (" + String(f) + "\n)")();
  console.log(name + ": " + show(() => f(...given)) + " | " + show(() => again(...given)));
}
