// answers: without-library
// # `thing.length === 1` in front of a branch is one call, and a list or a text answers in front of the moves of the call's arguments: the length in memory is held against the integer and the flags go back.
// # Every other receiver goes on: what the general read finds is held against the integer as `===` holds it: an int32, a number that is no int32, minus zero; anything else is not equal.
// # f1 = isEmpty, f2 = isOne, f3 = isTwo, f4 = isNotOne
// # RUN(ONE): bytes f2:Body mechanisms=all
// # ONE: argument thunk 0 LengthIs count 1
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL mechanisms=all
// # CHECK: exited with 0
function isEmpty(thing) { if (thing.length === 0) return 1; return 0; }
function isOne(thing) { if (thing.length === 1) return 1; return 0; }
function isTwo(thing) { if (2 === thing.length) return 1; return 0; }
function isNotOne(thing) { if (thing.length !== 1) return 1; return 0; }
function joined(left, right) { return left + right; }
const askers = [isEmpty, isOne, isTwo, isNotOne];
const sparse = [1];
sparse[70000] = 2;
sparse.length = 2;
const half = 0.5;
const key = joined("len", "gth");
function withLength(value) { const made = { }; made[key] = value; return made; }
const things = [[], [1], [1, 2], [0.5], [0.5, 1.5], ["a"], ["a", "b"], [{ }], sparse, "", "a", "ab", joined("a long enough text on the left, ", "and one on the right"), joined("", "a"), withLength(0), withLength(1), withLength(2), withLength(-0), withLength(half + half), withLength(1.5), withLength("1"), withLength(null), { }, 7, true, isOne, isTwo];
for (let round = 0; round < 3; round++) { for (const thing of things) { for (const ask of askers) report(ask(thing)); } }
report("end");
