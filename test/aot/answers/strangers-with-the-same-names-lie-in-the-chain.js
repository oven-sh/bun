// answers: without-library
// # The walk along a chain of boxes of an untyped file, in which lies what nobody expects: a literal with the same names, an accessor under one of them, a number, a text, undefined and null in the place of a box, a proxy, a list, a function.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 72 of 72 of 72
// # CHECK-NEXT: exited with 0
let asked = 0;
function box(mark, weight, around) { return { mark: mark, weight: weight, lid: weight > 3, around: around }; }
function heaviest(from) { let most = -1; for (let b = from; b !== null; b = b.around) { if (b.lid && b.weight > most) most = b.weight; } return most; }
function marks(from) { let text = ""; let n = 0; let b = from; while (b && n < 9) { text = b.mark + text; b = b.around; n++; } return text; }
function depth(from, mark) { let n = 0; for (let b = from; b !== null && b.mark !== mark; b = b.around) n++; return n; }
function lightOne(from, light) { let b = from; while (b !== null) { if (b.weight < light) return b.mark; b = b.around; } return "none"; }
function load(from) { let sum = 0; for (let b = from; b; b = b.around) sum += b.weight; return sum; }
function withGetter(name, value) { const b = box("g", 6, null); Object.defineProperty(b, name, { get: function () { asked++; return value; }, enumerable: true, configurable: true }); return b; }
const strangers = [];
strangers.push(function () { return { mark: "x", weight: 4, lid: true, around: null }; });
strangers.push(function () { return { around: null, lid: false, weight: 7, mark: "y" }; });
strangers.push(function () { return withGetter("weight", 8); });
strangers.push(function () { return withGetter("around", null); });
strangers.push(function () { return 7; });
strangers.push(function () { return "ab"; });
strangers.push(function () { return undefined; });
strangers.push(function () { return null; });
strangers.push(function () { return new Proxy(box("w", 5, null), { get: function (target, name) { asked++; return target[name]; } }); });
strangers.push(function () { return [1, 2]; });
strangers.push(function () { return box; });
strangers.push(function () { return Object.freeze(box("f", 9, null)); });
strangers.push(function () { const b = Object.create(null); b.weight = 2; b.around = null; return b; });
strangers.push(function () { const b = box("s", 1, null); b.weight = "9"; return b; });
const walks = [heaviest, marks, function (from) { return depth(from, "low"); }, function (from) { return lightOne(from, 3); }, load];
function answer(walk, from) { try { const value = walk(from); return value === undefined ? "nothing" : "" + value; } catch (error) { return error instanceof TypeError ? "a TypeError" : "another error"; } }
for (let turn = 0; turn < 3; turn++) for (let i = 0; i < walks.length; i++) answer(walks[i], box("a", 5, box("b", 4, null)));
for (let i = 0; i < strangers.length; i++) for (let k = 0; k < walks.length; k++) report(answer(walks[k], box("top", 4, box("mid", 3, strangers[i]()))));
report(asked);
report("end");
