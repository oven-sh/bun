// `const [[x]] = v`: a stack trace shows both lists at one place, and the message quotes the list that was given null or undefined.
function declared(v) { const [[x]] = v; return [x]; }
function parameter([[x]]) { return [x]; }
const arrow = ([[x]]) => [x];
function threeDeep(v) { const [[[x]]] = v; return [x]; }
function sideBySide(v) { const [[x], [y]] = v; return [x, y]; }
function behindAHole(v) { const [, [x]] = v; return [x]; }
function behindAName(v) { const [a, [x]] = v; return [a, x]; }
function inTheRest(v) { const [...[[x]]] = v; return [x]; }
function withADefault(v) { const [[x] = null] = v; return [x]; }
function underAName(v) { const { p: [[x]] } = v; return [x]; }
function inALoop(v) { for (const [[x]] of v) return [x]; }
function caught(v) { try { throw v; } catch ([[x]]) { return [x]; } }
function twoStatements(v, w) { const [[x]] = v; const [[y]] = w; return [x, y]; }
function assigned(v) { let x; [[x]] = v; return [x]; }
function aroundAnObject(v) { const [{ p: [x] }] = v; return [x]; }
function show(name, run) {
  try {
    console.log(name, "returned", JSON.stringify(run()));
  } catch (error) {
    console.log(name + ":", error.name + ": " + error.message, "at", /:(\d+:\d+)\)?$/.exec(error.stack.split("\n")[1])[1]);
  }
}
// An executable keeps the text of a function that something may ask for it.
globalThis.kept = { declared, parameter, arrow, threeDeep, sideBySide, behindAHole, behindAName, inTheRest, withADefault, underAName, inALoop, caught, twoStatements, assigned, aroundAnObject, show };

for (const nothing of [null, undefined]) {
  show("declared, the outer list", () => declared(nothing));
  show("declared, the inner list", () => declared([nothing]));
  show("a parameter, the outer list", () => parameter(nothing));
  show("a parameter, the inner list", () => parameter([nothing]));
  show("a parameter of an arrow function, the outer list", () => arrow(nothing));
  show("a parameter of an arrow function, the inner list", () => arrow([nothing]));
  show("three lists, the outer one", () => threeDeep(nothing));
  show("three lists, the middle one", () => threeDeep([nothing]));
  show("three lists, the inner one", () => threeDeep([[nothing]]));
  show("two lists in a list, the outer one", () => sideBySide(nothing));
  show("two lists in a list, the first", () => sideBySide([nothing, [1]]));
  show("two lists in a list, the second", () => sideBySide([[1], nothing]));
  show("behind a hole, the outer list", () => behindAHole(nothing));
  show("behind a hole, the inner list", () => behindAHole([1, nothing]));
  show("behind a name, the outer list", () => behindAName(nothing));
  show("behind a name, the inner list", () => behindAName([1, nothing]));
  show("in the rest, the outer list", () => inTheRest(nothing));
  show("in the rest, the inner list", () => inTheRest([nothing]));
  show("with a default, the outer list", () => withADefault(nothing));
  show("with a default, the inner list", () => withADefault([nothing]));
  show("under a name, the outer list", () => underAName({ p: nothing }));
  show("under a name, the inner list", () => underAName({ p: [nothing] }));
  show("in the head of a loop, what is walked", () => inALoop(nothing));
  show("in the head of a loop, the outer list", () => inALoop([nothing]));
  show("in the head of a loop, the inner list", () => inALoop([[nothing]]));
  show("caught, the outer list", () => caught(nothing));
  show("caught, the inner list", () => caught([nothing]));
  show("the first of two statements, the inner list", () => twoStatements([nothing], [[1]]));
  show("the second of two statements, the outer list", () => twoStatements([[1]], nothing));
  show("the second of two statements, the inner list", () => twoStatements([[1]], [nothing]));
  show("assigned, the outer list", () => assigned(nothing));
  show("assigned, the inner list", () => assigned([nothing]));
  show("around an object, the outer list", () => aroundAnObject(nothing));
  show("around an object, the inner list", () => aroundAnObject([{ p: nothing }]));
}
show("nothing is wrong", () => [declared([[1]]), parameter([[2]]), threeDeep([[[3]]]), sideBySide([[4], [5]]), inTheRest([[6]]), inALoop([[[7]]]), caught([[8]])]);
