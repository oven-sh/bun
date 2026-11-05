// answers: without-library
// # a read of a character behind a test of the program that holds the position below the length answers as the read with its own test does: for the empty text, one unit, narrow and wide units, pairs and lone surrogates, a rope
// # f1 = lessOne, f2 = lessTwo, f3 = furtherUp, f4 = last, f5 = lastLessOne, f6 = lastPoint, f7 = oneBehind, f8 = letters, f9 = upTo
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: : int[0, 65535] {{*}}= GetStringCodeUnit
// # RUN(UNASKED): walk f1 mechanisms=all
// # UNASKED-NOT: = Less v
// # RUN(UP): walk f3 mechanisms=all
// # UP-LABEL: code f3:Body
// # UP-COUNT-1: = Less v
// # RUN(ROUND): walk f4 mechanisms=all
// # ROUND-LABEL: code f4:Body
// # ROUND: : int[-1, 65535] @Int32{{*}}isLoopHead=true
// # RUN(ROUNDTOO): walk f5 mechanisms=all
// # ROUNDTOO-LABEL: code f5:Body
// # ROUNDTOO: : int[-1, 65535] @Int32{{*}}isLoopHead=true
// # RUN(POINT): walk f6 mechanisms=all
// # POINT-LABEL: code f6:Body
// # POINT: : int[-1, 1114111] @Int32{{*}}isLoopHead=true
// # RUN(BEHIND): walk f7 mechanisms=all
// # BEHIND-LABEL: code f7:Body
// # BEHIND: : int[-1, 65535]|whole @Double{{*}}isLoopHead=true
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 199 of 199 of 199
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-LoopInvariants $SHELL
// # ALSO1: 199 of 199 of 199
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO2: 199 of 199 of 199
// # ALSO2-NEXT: exited with 0
// # RUN(ALSO3): run-in-shell mechanisms=-Folding $SHELL
// # ALSO3: 199 of 199 of 199
// # ALSO3-NEXT: exited with 0
declare function report(value: unknown): void;
function lessOne(text: string): number { let sum = 0; for (let pos = 0; pos <= text.length - 1; pos++) sum = (sum * 31 + text.charCodeAt(pos)) | 0; return sum; }
function lessTwo(text: string): string { let seen = ""; for (let pos = 0; pos < text.length - 2; pos++) seen += text.charCodeAt(pos) + "," + text.charCodeAt(pos + 2) + "," + text.charCodeAt(pos + 3) + ";"; return seen; }
function furtherUp(text: string, from: number, flag: boolean): number { const pos = from & 3; if (pos < text.length) { if (flag) return text.charCodeAt(pos); return -1; } return -2; }
function last(text: string): number { let code = -1; for (let pos = 0; pos < text.length; pos++) code = text.charCodeAt(pos); return code; }
function lastLessOne(text: string): number { let code = -1; for (let pos = 0; pos <= text.length - 1; pos++) code = text.charCodeAt(pos); return code; }
function lastPoint(text: string): number { let point = -1; for (let pos = 0; pos < text.length; pos++) point = text.codePointAt(pos)!; return point; }
function oneBehind(text: string): number { let code = -1; for (let pos = 0; pos < text.length; pos++) code = text.charCodeAt(pos + 1); return code; }
function letters(text: string): string { let seen = ""; for (let pos = 0; text.length > pos; pos++) seen += text[pos] + text.charAt(pos); return seen; }
function upTo(text: string): string { const end = text.length; let seen = ""; let pos = 0; while (true) { if (pos >= end) break; seen += text.charCodeAt(pos) + ","; pos++; } return seen + text.charCodeAt(pos); }
const texts = ["", "a", "ab", "abc", "abcd", String.fromCharCode(0x4e2d, 0x6587), "ab" + String.fromCharCode(0x100), "a\ud83d\ude00", "a\ud83d", "\ude00a", "abcdefghij" + "klmnopqrstuvwxyz0123456789"];
for (let which = 0; which < texts.length; which++) { const text = texts[which]; report(lessOne(text)); report(lessTwo(text)); report(last(text)); report(lastLessOne(text)); report(lastPoint(text)); report(oneBehind(text)); report(letters(text)); report(upTo(text)); for (let from = 0; from < 5; from++) { report(furtherUp(text, from, true)); report(furtherUp(text, from, false)); } }
report("end");
