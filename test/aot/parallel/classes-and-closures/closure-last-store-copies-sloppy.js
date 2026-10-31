// The same in sloppy code and around odd control flow: mapped arguments, comma and nested assignments, loop heads that store, generators, await, labels, defaults, with, redeclared names
function mapped(a) { a = 1; const read = () => a; arguments[0] = 3; return read; }
function mappedNeverStored(a) { const read = () => a; arguments[0] = 4; return read; }
function mappedThroughHelper(a) { a = 1; const read = () => a; change(arguments); return read; }
function change(list) { list[0] = 5; }
function commaBehind() { let c = 0, f; c = 1, f = () => c; return f; }
function commaInFront() { let c = 0, f; f = () => c, c = 2; return f; }
function nestedAssignment() { let c = 0, g; c = (g = () => c, 5); return g; }
function chain() { let c = 0, d = 0; c = d = 3; return () => c + d; }
function forOfTarget(list) { let c = 0; for (c of list) {} return () => c; }
function forInTarget(object) { let c = ""; for (c in object) {} return () => c; }
function* generator() { let c = 0; c = 1; const early = () => c; yield early; c = 2; yield () => c; }
async function awaited() { let c = 0; const early = () => c; await 0; c = 1; return [early, () => c]; }
function labeled(flag) { let c = 0, f = () => -1; out: { if (flag) break out; c = 1; f = () => c; } c = 2; return f; }
function doWhile() { let c = 0, all = []; do { c++; all.push(() => c); } while (c < 3); return all; }
function defaulted(a, b = () => a) { a = 9; return b; }
function defaultedBehind(a, b = (a = 7, () => a)) { return b; }
function withStatement(object) { let c = 0; with (object) { c = 1; } return () => c; }
function logical(c) { c ||= 5; c &&= c + 1; c ??= 0; return () => c; }
function redeclared() { var c = 1; var read = () => c; var c = 2; return read; }
function functionNameStored() { function c() { return 1; } c = () => 2; return () => c(); }
function catchStores() { let c = 0, read; try { read = () => c; throw 1; } catch (e) { c = e; } return read; }
function typeofAndDelete() { let c = 0; c = 1; typeof c; return () => c; }
function twice() { const all = []; for (const n of [1, 2]) { let c = 0; c = n; all.push(() => c); } return all; }
const g = generator(), first = g.next().value, second = g.next().value;
console.log(mapped(0)(), mappedNeverStored(0)(), mappedThroughHelper(0)(), commaBehind()(), commaInFront()(), nestedAssignment()(), chain()(), forOfTarget([1, 8])(), forInTarget({ k: 1 })());
console.log(first(), second(), labeled(true)(), labeled(false)(), doWhile().map(f => f()).join(), defaulted(1)(), defaultedBehind(1)(), withStatement({})(), withStatement({ c: 4 })(), logical(0)(), redeclared()(), functionNameStored()(), catchStores()(), typeofAndDelete()(), twice().map(f => f()).join());
awaited().then(pair => console.log(pair.map(f => f()).join()));
