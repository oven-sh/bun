// answers: without-library
// # one text grows in loops inside loops, with no turn of the inner or of the outer one, is read in the inner loop, is a part of a text of the inner loop, and is returned from the inner loop
// # f1 = table, f2 = deep, f3 = reset, f4 = nested, f5 = readInside, f6 = leftInside
// # RUN(FORM): walk f1 f2 f6 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM-COUNT-1: StringBuilderBegin
// # FORM-NOT: StringBuilderBegin
// # FORM: StringBuilderFinish
// # FORM-LABEL: code f2:Body
// # FORM-COUNT-1: StringBuilderBegin
// # FORM-NOT: StringBuilderBegin
// # FORM: StringBuilderFinish
// # FORM-LABEL: code f6:Body
// # FORM-COUNT-1: StringBuilderBegin
// # FORM: StringBuilderFinish
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function table(rows: number, columns: number) { let s = ""; for (let i = 0; i < rows; i++) { for (let j = 0; j < columns; j++) s += "c" + j; s += ";"; } return s; }
function deep(n: number) { let s = "^"; for (let i = 0; i < n; i++) { for (let j = 0; j < i; j++) { for (let k = 0; k < j; k++) s += "k" + k; s += ","; } s += ";"; } return s; }
function reset(rows: number, columns: number) { let s = ""; let out = 0; for (let i = 0; i < rows; i++) { for (let j = 0; j < columns; j++) s += "x"; out += s.length; s = ""; } return out; }
function nested(rows: number, columns: number) { let s = ""; let out = ""; for (let i = 0; i < rows; i++) { s += "x"; let t = ""; for (let j = 0; j < columns; j++) t += s; out = out + t + "|"; } return out + s; }
function readInside(rows: number, columns: number) { let s = ""; let out = 0; for (let i = 0; i < rows; i++) { s += "ab"; for (let j = 0; j < columns; j++) out += s.charCodeAt(j) + s.length; } return out; }
function leftInside(rows: number, stop: number) { let s = ""; for (let i = 0; i < rows; i++) { for (let j = 0; j < rows; j++) { s += "c" + j; if (j === stop) return s + "!"; } s += ";"; } return s; }
report(table(0, 3));
report(table(3, 0));
report(table(1, 1));
report(table(3, 4));
report(table(40, 40).length);
report(deep(0));
report(deep(2));
report(deep(5));
report(reset(4, 3));
report(nested(0, 2));
report(nested(3, 2));
report(nested(3, 0));
report(readInside(3, 2));
report(leftInside(3, 9));
report(leftInside(3, 1));
report(leftInside(3, 0));
report("end");
