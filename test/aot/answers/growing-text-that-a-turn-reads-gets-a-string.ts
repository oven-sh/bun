// answers: without-library
// # a turn hands the growing text to a function of the program, stores it, compares it, reads under it, switches on it. Each string that was handed out stays what it was while the builder goes on. A text that every iteration hands on or stores is in no builder
// # f1 = keep, f2 = handed, f3 = states, f4 = compared, f5 = keyed, f6 = twice, f7 = sometimes, f8 = switched
// # RUN(FORM): walk f2 f3 f7 mechanisms=all
// # FORM-LABEL: code f2:Body
// # FORM: StringBuilderBegin
// # FORM: StringBuilderToString
// # FORM-LABEL: code f3:Body
// # FORM: StringBuilderBegin
// # FORM: StringBuilderToString
// # FORM-LABEL: code f7:Body
// # FORM: StringBuilderBegin
// # FORM: StringBuilderToString
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Inlining $SHELL
// # ALSO1: 17 of 17 of 17
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
let held = "";
function keep(text: string) { held = held + "[" + text + "]"; }
function handed(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += "k" + i; if (i % 4 !== 3) keep(s); } return s; }
function states(n: number) { const kept: string[] = []; let s = ""; for (let i = 0; i < n; i++) { s += "k" + i; if (i % 4 === 3) kept[i] = ""; else kept[i] = s; } let all = ""; for (let i = 0; i < n; i++) all = all + kept[i] + "|"; return all + s; }
function compared(n: number) { let s = ""; let hits = 0; for (let i = 0; i < n; i++) { s += "ab"; if (s === "ababab") hits += i + 1; } return hits; }
function keyed(n: number) { const table: Record<string, number> = { a: 1, aa: 20, aaa: 300 }; let s = ""; let sum = 0; for (let i = 0; i < n; i++) { s += "a"; sum += table[s] ?? 4000; } return sum; }
function twice(n: number) { let s = ""; let out = ""; for (let i = 0; i < n; i++) { s += "k" + i; const one = s; const two = s; out = out + (one === two) + one.length + two.charAt(1); } return out; }
function sometimes(n: number) { let s = ""; let out = ""; for (let i = 0; i < n; i++) { s += "k" + i; if (i % 3 === 1) out = out + "(" + s + ")"; } return out + s; }
function switched(n: number) { let s = ""; let out = 0; for (let i = 0; i < n; i++) { s += "a"; switch (s) { case "a": out += 1; break; case "aaa": out += 100; break; default: out += 10000; } } return out; }
report(handed(0));
report(held);
report(handed(3));
report(held);
report(states(0));
report(states(1));
report(states(5));
report(states(300).length);
report(compared(2));
report(compared(9));
report(keyed(0));
report(keyed(5));
report(twice(3));
report(sometimes(0));
report(sometimes(8));
report(switched(4));
report("end");
