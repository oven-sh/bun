// answers: without-library
// # The walk along a chain of boxes of an untyped file, each of which lies in another one. One layout of the program has all the names that the loop's variable is asked for, so it is expected; boxes that JSON.parse made, with the same names in another order, lie in the chain too.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
function box(mark, weight, around) { return { mark: mark, weight: weight, lid: weight > 3, around: around }; }
function heaviest(from) { let most = -1; for (let b = from; b !== null; b = b.around) { if (b.lid && b.weight > most) most = b.weight; } return most; }
function marks(from) { let text = ""; let b = from; while (b) { text = b.mark + text; if (b.weight === 99) break; b = b.around; } return text; }
function depth(from, mark) { let n = 0; for (let b = from; b !== null && b.mark !== mark; b = b.around) n++; return n; }
function lightOne(from, light) { let b = from; while (b !== null) { if (b.weight < light) return b.mark; b = b.around; } return "none"; }
function chain(n) { let b = null; for (let i = 0; i < n; i++) b = box("m" + i, (i * 7) % 11, b); return b; }
const parsed = JSON.parse('{"around":null,"lid":true,"weight":5,"mark":"p"}');
const longer = JSON.parse('{"weight":9,"mark":"q","tag":1,"around":{"mark":"r","around":{"lid":false,"mark":"s","weight":2,"around":null},"weight":4,"lid":true},"lid":true}');
const mixed = chain(4);
let last = mixed;
while (last.around !== null) last = last.around;
last.around = parsed;
report(heaviest(chain(6)));
report(marks(chain(6)));
report(depth(chain(6), "m2"));
report(lightOne(chain(6), 2));
for (let turn = 0; turn < 2; turn++) report(heaviest(mixed) + marks(mixed) + depth(mixed, "p"));
report(heaviest(longer));
report(marks(longer));
report(depth(longer, "s"));
report(lightOne(longer, 3));
report(heaviest(box("t", 50, longer)) + marks(box("u", 1, longer)));
parsed.around = box("v", 99, box("w", 1, null));
report(marks(mixed) + heaviest(mixed) + lightOne(mixed, 2));
report("end");
