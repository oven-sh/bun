// answers: without-library
// # a text that grows in the frame of its function is what the joins give: no turn and many, more than the 128 characters of the record, characters of 16 bits, halves of pairs, ropes, every kind of part, two texts at once, loops in loops, frames in frames, and left by break, return and throw
// # the string that the text began with comes back where nothing with characters followed it, whatever it is: empty, wide, a rope, longer than the record
// # f3 = digits, f4 = keys, f5 = grown, f6 = kinds, f7 = early, f8 = broken, f9 = read, f10 = two, f11 = nested, f1 = deep, f2 = thrown, f12 = wide, f13 = told, f14 = tell
// # RUN(FORM): walk f3 mechanisms=all
// # FORM-LABEL: code f3:Body
// # FORM: = StackStringBuilderBegin
// # RUN(KINDS): walk f6 mechanisms=all
// # KINDS-LABEL: code f6:Body
// # KINDS: = StackStringBuilderAppendBoolean
// # RUN(TWO): walk f10 mechanisms=all
// # TWO-LABEL: code f10:Body
// # TWO-COUNT-2: = StackStringBuilderBegin
// # RUN(DEEP): walk f1 mechanisms=all
// # DEEP-LABEL: code f1:Body
// # DEEP: = StackStringBuilderBegin
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 126 of 126 of 126
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO1: 126 of 126 of 126
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
function digits(n: number) { let s = ""; for (let i = 0; i < n; i++) s += i; return s; }
function keys(n: number) { let s = ""; for (let i = 0; i < n; i++) s += "k" + i + ","; return s; }
function grown(prefix: string, part: string, n: number) { let out = prefix; for (let i = 0; i < n; i++) out += part; return out; }
function kinds(n: number, flag: boolean, text: string | null | undefined) { let s = ""; for (let i = 0; i < n; i++) { s += flag; s += text; s += i * 0.5; s += -0; s += ";"; } return s; }
function early(n: number, stop: number) { let s = "<"; for (let i = 0; i < n; i++) { if (i === stop) return s + "!"; s += i; } return s + ">"; }
function broken(n: number, stop: number) { let s = ""; for (let i = 0; i < n; i++) { s += i; if (i === stop) break; s += ","; } return s; }
function read(n: number) { let s = ""; let seen = ""; for (let i = 0; i < n; i++) { s += "k"; const kept = s; s += i; seen += kept + "|" + s + ";"; } return seen; }
function two(n: number) { let s = ""; let t = "t"; for (let i = 0; i < n; i++) { s += i; t += s.length; s += "-"; } return s + "/" + t; }
function nested(n: number) { let all = ""; for (let i = 0; i < n; i++) { let row = ""; for (let j = 0; j <= i; j++) { row += j; all += "."; } all += row + ";"; } return all; }
function deep(depth: number): string { let s = ""; for (let i = 0; i < depth; i++) s += "(" + deep(depth - 1) + ")"; return s; }
function thrown(n: number, stop: number) { let s = ""; for (let i = 0; i < n; i++) { if (i === stop) throw s; s += i; } return s; }
function wide(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += i; if (i === 2) s += "Ā"; s += "é"; } return s; }
function told(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += i; report(i); s += ","; } return s; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report("caught " + e); } }
for (let n = 0; n < 14; n += 3) report(digits(n));
report(digits(80));
report(digits(300).length);
for (let n = 0; n < 4; n++) report(keys(n));
report(keys(40));
report(grown("", "", 3));
report(grown("a", "", 3));
report(grown("ab", "c", 0));
report(grown("ab", "c", 2));
report(grown("", "c", 2));
report(grown("Ā", "", 2));
report(grown("Ā", "é", 3));
report(grown("é", "Ā", 1));
report(grown("\ud800", "\udc00", 1) === "𐀀");
report(grown("\ud800", "", 1).length);
report(grown(digits(5) + keys(2), "", 1));
report(grown(digits(5) + keys(2), "!", 1));
report(grown(digits(80), "", 2));
report(grown(digits(80), "x", 2));
report(grown("x", digits(80), 2));
report(kinds(2, true, "t"));
report(kinds(2, false, null));
report(kinds(1, true, undefined));
report(kinds(0, true, "t"));
report(early(5, 9));
report(early(5, 0));
report(early(5, 3));
report(early(200, 150).length);
report(broken(5, 9));
report(broken(5, 0));
report(broken(5, 2));
report(read(0));
report(read(3));
report(read(60).length);
report(two(0));
report(two(12));
report(two(90).length);
report(nested(0));
report(nested(4));
report(nested(30).length);
report(deep(0));
report(deep(3));
report(deep(5).length);
tell(() => thrown(5, 9));
tell(() => thrown(5, 0));
tell(() => thrown(5, 3));
tell(() => thrown(200, 150));
tell(() => thrown(5, 9));
report(wide(0));
report(wide(2));
report(wide(5));
report(wide(90).length);
report(told(0));
report(told(3));
report(told(60).length);
report("end");
