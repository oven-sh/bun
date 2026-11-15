// answers: without-library
// # A turn that is seldom taken is moved out of its loop, and what the loop keeps in registers, in a list that it fills or in a text that it builds goes along. Here such turns are taken: they empty the list, store to the variable that the loop carries, and wrap the text.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
function collect(list) { const out = []; let seen = 0; for (let i = 0; i < list.length; i++) { const value = list[i]; if (typeof value !== "number") { seen++; out.length = 0; continue; } out.push(value * 2); } return out.length + ":" + seen + ":" + (out.length ? out[out.length - 1] : "none"); }
report(collect([1.5, 2.5, 3.5])); report(collect([1.5, "x", 3.5])); report(collect([1.5, 2.5, undefined])); report(collect([]));
const state = { total: 0, odd: 0 };
function tally(list) { state.total = 0; for (let i = 0; i < list.length; i++) { if (list[i] === null) { state.odd++; state.total = -1; } else state.total += list[i]; } return state.total + ":" + state.odd; }
report(tally([1, 2, 3])); report(tally([1, null, 3])); report(tally([null]));
function text(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (list[i] === undefined) { s = "(" + s + ")"; continue; } s += list[i]; } return s; }
report(text(["a", "b"])); report(text(["a", undefined, "b"]));
report("end");
