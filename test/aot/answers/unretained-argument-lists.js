// answers: without-library
// # arguments, rest parameters, spread and apply: the list is read, measured, changed, cut short and handed on, with no operand and with more than are declared.
// # At the end the shell runs the same text itself: every answer is the same.
// # Where a guess about a list fails, `for of` goes by the protocol and calls `next` of the iterators of arrays, which is a function of the library. So the text brings that function.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
function count() { return arguments.length; }
function last() { return arguments[arguments.length - 1]; }
function total(...all) { let sum = 0; for (const each of all) sum += each; return sum; }
function spreadOn(...all) { return total(...all, 1); }
function applied(list) { return total.apply(null, list) + ":" + count.apply(null, list) + ":" + Math.max.apply(null, list); }
function pushed(list, ...more) { list.push(...more); return list.length + ":" + list.join(); }
function changed(a, b) { arguments[0] = 9; b = 8; return a + ":" + arguments[1] + ":" + arguments.length; }
function strictly(a, b) { "use strict"; arguments[0] = 9; b = 8; return a + ":" + arguments[1] + ":" + arguments.length; }
function sized(...all) { all.length = 1; return all.length + ":" + all[1]; }
report(count()); report(count(1, 2, 3)); report(last(1, "z")); report(last()); report(total()); report(total(1, 2.5)); report(spreadOn(1, 2)); report(spreadOn());
report(applied([1, 2, 3])); report(applied([])); report(pushed([1], 2, 3)); report(pushed([])); report(changed(1, 2)); report(changed(1)); report(strictly(1, 2)); report(sized(1, 2, 3));
report("end");
