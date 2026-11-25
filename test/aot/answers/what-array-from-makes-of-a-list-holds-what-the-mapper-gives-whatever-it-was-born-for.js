// answers: with-library
// # The list that Array.from makes out of a list and a mapper holds what the mapper gives, of which the list says nothing: it is born as a list made with a length is. Whatever the mapper gives, first or later, the list holds that: an integer, one too large for 32 bits, a fraction, -0, NaN,
// # a text, a boolean, null, undefined, an object; in every order of two of them; over lists of objects, texts, integers, fractions, and one with a hole.
// # Where the mapper is seen to give integers the list is born for them, though its source holds texts.
// # f1 = places
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = NewArrayLike {{*}}arrayStorage=Int32
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 734 of 734 of 734
// # CHECK-NEXT: exited with 0
function tell(deed) { try { report(deed()); } catch (error) { report(error.constructor.name); } }
function text(list) { let all = String(list.length); for (let i = 0; i < list.length; i++) all += "|" + (i in list ? (Object.is(list[i], -0) ? "-0" : String(list[i])) : "hole"); return all; }
const kept = { toString() { return "kept"; } };
const values = [1, -0, 1.5, NaN, "t", true, null, undefined, kept, 2147483647, 2147483648, -2147483649];
const holed = [kept, kept, kept, kept, kept];
delete holed[3];
const sources = [[kept, kept, kept, kept, kept], ["a", "b", "c", "d", "e"], [1, 2, 3, 4, 5], [0.5, 1.5, 2.5, 3.5, 4.5], holed];
function mapped(source, first, rest, turn) { return Array.from(source, (_, k) => k < turn ? first : rest); }
function places(texts) { return Array.from(texts, (_, k) => k * 2); }
function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i]; return total; }
for (let s = 0; s < sources.length; s++) { for (let a = 0; a < values.length; a++) { for (let b = 0; b < values.length; b++) { tell(() => text(mapped(sources[s], values[a], values[b], 2))); } } }
for (let a = 0; a < values.length; a++) { tell(() => { const list = mapped(sources[0], 1, 2, 2); list[4] = values[a]; list.push(values[a]); return text(list); }); }
tell(() => sum(places(sources[1])));
report("end");
