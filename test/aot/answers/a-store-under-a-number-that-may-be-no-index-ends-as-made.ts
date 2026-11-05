// answers: without-library
// # A number that is no index (NaN, Infinity, a fraction, 4294967295, -1) lays a NAME on the list: its Structure is another and the mark of its cell is gone. Link knows that a key holds only numbers and never that it is an index,
// # so a store under a computed number ends "stays as its class has made it" for the site. That word is held against the object wherever it is taken: the program would stop where it were false.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
function lay(list: unknown[], key: number): string { list[key] = "x"; return Object.keys(list).join() + "/" + list.indexOf("x") + "/" + list.includes("x") + "/" + list.length + "/" + list.join("+"); }
const zero = report.length > 9 ? 1 : 0;
report(lay([1], zero / zero));
report(lay([1], 1 / zero));
report(lay([1], 1.5 + zero));
report(lay([1], 4294967295 + zero));
report(lay([1], -1 - zero));
report(lay([1], 1 + zero));
report("end");
