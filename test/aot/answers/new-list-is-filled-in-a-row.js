// answers: with-library
// # `new Array(n).fill(v)` and `Array.from({ length: n })`: the prelude makes the list with its length and fills it by ONE operation: one look at the storage, then a store, an increment and a compare for each place.
// # A loop of TryPutByValDirect asked the poll, the bound, the indexing byte, the storage, the length and the barrier at every place: 110 + 18 n instructions where plain takes 270 + 5 n.
// # The loop stays behind the operation for a list whose storage does not hold boxed values.
// # f21 = filledArray, f20 = arrayOfUndefined
// # RUN(FORM): walk f21 f20 mechanisms=all
// # REQUIRES(FORM): entries-of-bun
// # FORM-LABEL: code f21:Body
// # FORM: [[made]]: Array @Cell = NewArrayLike
// # FORM-NEXT: [[isFilled]]: boolean @Boolean = TryFillNewArray [[made]],
// # FORM-NEXT: Branch [[isFilled]]
// # FORM-LABEL: code f20:Body
// # FORM: [[blank]]: Array @Cell = NewArrayLike
// # FORM-NEXT: = TryFillNewArray [[blank]],
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # REQUIRES: entries-of-bun
// # CHECK: 110 of 110 of 110
// # CHECK-NEXT: exited with 0
function tell(deed) { try { report(deed()); } catch (error) { report(error.constructor.name); } }
function text(list) { let all = String(list.length); for (let i = 0; i < list.length; i++) all += "|" + (i in list ? String(list[i]) : "hole"); return all; }
function fills(n, v) { return new Array(n).fill(v); }
function blanks(n) { return Array.from({ length: n }); }
const kept = { toString() { return "kept"; } };
const values = [1, -0, 1.5, NaN, "t", true, null, undefined, kept];
const lengths = [0, 1, 2, 3, 8, 126, 127, 128, 129, 1000];
for (let n = 0; n < lengths.length; n++) { for (let v = 0; v < values.length; v++) { tell(() => text(fills(lengths[n], values[v]))); } tell(() => text(blanks(lengths[n]))); }
tell(() => { const list = fills(2, 1); list.push("more"); list[0] = 0.5; return text(list); });
tell(() => { const list = fills(3, kept); return list[0] === kept && list[2] === kept; });
tell(() => Object.is(fills(2, -0)[1], -0));
tell(() => fills(-1, 0).length);
tell(() => fills(1.5, 0).length);
tell(() => text(fills("3", 0)));
tell(() => text(fills(undefined, 0)));
tell(() => text(blanks(-1)));
tell(() => text(blanks("2")));
report("end");
