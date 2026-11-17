// answers: without-library
// # parts whose text is at hand: written texts short and long, of one byte and of two a character, halves of a pair, undefined, null, the booleans, and the empty text, which is no part
// # f1 = separated, f2 = wide, f3 = long, f4 = empty, f5 = codes
// # RUN(FORM): walk f1 f2 f3 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: StringBuilderAppendConstant {{*}}string=", "
// # FORM: StringBuilderAppendConstant {{*}}string="undefined"
// # FORM: StringBuilderAppendConstant {{*}}string="null"
// # FORM-LABEL: code f2:Body
// # FORM: StringBuilderAppendConstant
// # FORM-LABEL: code f3:Body
// # FORM: StringBuilderAppendConstant
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function separated(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += ", "; s += ""; s += undefined; s += null; s += true; s += false; } return s; }
function wide(n: number) { let s = "é"; for (let i = 0; i < n; i++) { s += "Ā"; s += "é"; s += "\ud83d"; s += "\ude00"; } return s; }
function long(n: number) { let s = "["; for (let i = 0; i < n; i++) s += "a text that is longer than the sixteen bytes that fit into two words"; return s + "]"; }
function empty(n: number) { let s = ""; for (let i = 0; i < n; i++) s += ""; return s; }
function codes(text: string) { let sum = 0; for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) % 1000003; return sum; }
report(separated(0));
report(separated(1));
report(separated(3));
report(separated(200).length);
report(wide(0));
report(wide(1).length);
report(codes(wide(1)));
report(codes(wide(40)));
report(wide(2) === "éĀé😀Āé😀");
report(long(0));
report(long(1));
report(long(90).length);
report(codes(long(90)));
report(empty(0));
report(empty(5));
report(empty(5).length);
report("end");
