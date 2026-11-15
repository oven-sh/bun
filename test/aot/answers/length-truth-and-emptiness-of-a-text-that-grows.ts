// answers: without-library
// # the length, the truth and the emptiness that the builder answers are those of the string: between two appends of one block, in two arms, in a loop inside, of a text of 16 bits, of a text that enters with characters
// # f1 = rows, f2 = joined, f3 = spaced, f4 = lengths, f5 = wide, f6 = begun, f7 = inner, f8 = both, f9 = read, f10 = arms, f11 = last, f12 = marked
// # RUN(FORM): walk f4 mechanisms=all
// # FORM-LABEL: code f4:Body
// # FORM: StringBuilderLength
// # FORM: StringBuilderLength
// # FORM: StringBuilderLength
// # RUN(TRUTH): walk f2 mechanisms=all
// # TRUTH-LABEL: code f2:Body
// # TRUTH: StringBuilderLength
// # RUN(ARMS): walk f10 mechanisms=all
// # ARMS-LABEL: code f10:Body
// # ARMS: StringBuilderLength
// # ARMS: StringBuilderLength
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 43 of 43 of 43
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO1: 43 of 43 of 43
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
function rows(n: number) { let s = ""; for (let i = 0; i < n; i++) { if (s.length > 8) s += "|"; s += i; } return s; }
function joined(n: number) { let s = ""; for (let i = 0; i < n; i++) { if (s) s += ","; s += i; } return s; }
function spaced(n: number) { let s = ""; for (let i = 0; i < n; i++) { if (s !== "") s += " "; if (i % 3) s += i; } return s; }
function lengths(n: number) { let s = ""; let sum = 0; for (let i = 0; i < n; i++) { sum += s.length; s += "ab"; sum += s.length; s += i; sum += s.length; } return sum + ":" + s.length; }
function wide(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += "Ā"; if (s.length === 3) s += "!"; } return s + s.length; }
function begun(head: string, n: number) { let s = head; let seen = ""; for (let i = 0; i < n; i++) { seen += s.length + (s ? "y" : "n") + (s === "" ? "e" : "f"); s += ""; seen += s.length; s += "x"; } return seen + "/" + s; }
function inner(n: number) { let s = ""; let sum = 0; for (let i = 0; i < n; i++) { s += "ab"; for (let j = 0; j < 3; j++) sum += s.length; } return sum; }
function both(n: number) { let s = ""; let t = ""; for (let i = 0; i < n; i++) { if (!s) t += "first"; s += i; if (t.length > s.length) s += "-"; t += s.length; } return s + "/" + t; }
function read(n: number) { let s = ""; let seen = ""; for (let i = 0; i < n; i++) { s += "k"; const kept = s; seen += kept.length + ":" + s.length + ";"; s += "l"; seen += kept.length + ":" + s.length + ";"; } return seen; }
function arms(n: number) { let s = ""; let odd = 0; let even = 0; for (let i = 0; i < n; i++) { if (i % 2) odd += s.length; else even += s.length; s += "xy"; } return odd + "/" + even; }
function last(n: number) { let s = ""; let sum = 0; for (let i = 0; i < n; i++) { s += i; sum += s.charCodeAt(s.length - 1); } return sum; }
function marked(n: number) { let s = ""; for (let i = 0; i < n; i++) { if (s === "0") s += ","; if ("0,1" == s) s += ";"; s += i; } return s; }
for (let n = 0; n < 14; n += 3) report(rows(n));
for (let n = 0; n < 5; n++) report(joined(n));
for (let n = 0; n < 8; n++) report(spaced(n));
for (let n = 0; n < 13; n += 4) report(lengths(n));
for (let n = 0; n < 5; n++) report(wide(n));
report(begun("", 0));
report(begun("", 3));
report(begun("ab", 2));
report(begun("Ā", 2));
report(inner(0));
report(inner(4));
report(both(0));
report(both(12));
report(read(3));
report(arms(0));
report(arms(5));
report(last(0));
report(last(12));
report(marked(1));
report(marked(4));
report("end");
