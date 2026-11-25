// answers: without-library
// # where the ranges decide something of a text the form leans on it, and the answers stay those of the methods: a written position behind every length reads nothing, substring puts the smaller bound first though its first bound is decided, a length is asked for zero only where zero and one are told apart, an order that was asked with the sides the other way round is turned, and a character is converted where it lies
// # f1 = farBehind, f2 = farBehindAsText, f3 = fromTheEnd, f4 = isEmpty, f5 = isOne, f6 = isLongerThanOne, f7 = turned, f8 = sumOfDigits, f9 = grown
// # each text comes proven out of the driver by its making, "" + text. An equality with a length is returned, not branched on: behind a Branch the front end hands its outcome on to a NarrowByField, and the form stays away
// # seven answers a text, then turned() for each pair: answer 1 is farBehind(""), 13 isLongerThanOne("a"), 17 fromTheEnd("ab", 1), 51 turned("", "a")
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM-NOT: = GetStringCodeUnit
// # RUN(EMPTY): walk f4 mechanisms=all
// # EMPTY-LABEL: code f4:Body
// # EMPTY-NOT: = GetStringLength
// # RUN(TURNED): walk f7 mechanisms=all
// # TURNED-LABEL: code f7:Body
// # TURNED: = StringOrder
// # TURNED-NOT: form=Strings
// # RUN(DIGITS): walk f8 mechanisms=all
// # DIGITS-LABEL: code f8:Body
// # DIGITS: = StringRangeToNumber
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 99 of 99 of 99
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function farBehind(s: string) { return s.charCodeAt(2147483647); }
function farBehindAsText(s: string) { return s.charAt(2147483647) + "|" + s.at(4294967296) + "|" + s.codePointAt(2147483647); }
function fromTheEnd(s: string, b: number) { return s.substring(2147483648, b); }
function isEmpty(s: string) { return s.length === 0; }
function isOne(s: string) { return s.length === 1; }
function isLongerThanOne(s: string) { return s.length > 1 ? 1 : 0; }
function turned(a: string, b: string) { return a <= b ? (b <= a ? 0 : -1) : 1; }
function sumOfDigits(s: string) { let sum = 0; for (let i = 0; i < s.length; i++) sum += +s[i]; return sum; }
function grown(n: number) { let text = ""; for (let i = 0; i < n; i++) text += "ab"; return text; }
const texts = ["", "a", "ab", "abc", "12", "Ā7", grown(3)];
for (let t = 0; t < texts.length; t++) { const s = "" + texts[t]; report(farBehind(s)); report(farBehindAsText(s)); report(fromTheEnd(s, 1)); report(isEmpty(s)); report(isOne(s)); report(isLongerThanOne(s)); report(sumOfDigits(s)); }
for (let t = 0; t < texts.length; t++) { for (let u = 0; u < texts.length; u++) report(turned("" + texts[t], "" + texts[u])); }
report("end");
