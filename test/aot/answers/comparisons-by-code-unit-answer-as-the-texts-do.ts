// answers: without-library
// # a comparison that asks the code unit, the cell, the order or the length answers as the comparison of the texts does: outside the text undefined stands in no relation and the empty text lies below every character, NaN equals nothing, and an object is converted once
// # f1 = isComma, f2 = isBehindEnd, f4 = isNothing, f7 = relations, f9 = relationsOfCode, f12 = lengths, f13 = order, f15 = verbs, f16 = belowLetter, f17 = loose, f18 = headIs
// # each text and position comes proven out of the driver, by its making and not by the typeof tests of the functions: "" + text is the same cell and position | 0 the same int32, so Link and the arrivals say string and i32 of the parameters
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = GetStringCodeUnit
// # FORM: = StrictEq {{*}}form=Integers
// # RUN(UNMADE): walk f1 mechanisms=all
// # UNMADE-NOT: = Substring
// # RUN(ORDER): walk f13 mechanisms=all
// # ORDER-LABEL: code f13:Body
// # ORDER: = StringOrder
// # RUN(LETTER): walk f16 mechanisms=all-LoopInvariants
// # LETTER-LABEL: code f16:Body
// # LETTER: = StringOrderToCharacter
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3195 of 3195 of 3195
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function isComma(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s[i | 0] === "," : "other"; }
function isBehindEnd(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s[i | 0] === undefined : "other"; }
function isNoText(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? typeof s[i | 0] !== "string" : "other"; }
function isNothing(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s.charAt(i) === "" : "other"; }
function elementIsNothing(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s[i | 0] === "" : "other"; }
function isLong(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s[i | 0] === ",," : "other"; }
function relations(s: unknown, i: unknown) { if (typeof s !== "string" || typeof i !== "number") return "other"; const c = s[i | 0]; return (c < "b" ? 1 : 0) + (c <= "b" ? 2 : 0) + (c > "b" ? 4 : 0) + (c >= "b" ? 8 : 0) + ("b" < c ? 16 : 0) + ("b" <= c ? 32 : 0) + ("b" > c ? 64 : 0) + ("b" >= c ? 128 : 0); }
function relationsOfCharAt(s: unknown, i: unknown) { if (typeof s !== "string" || typeof i !== "number") return "other"; const c = s.charAt(i); return (c < "b" ? 1 : 0) + (c <= "b" ? 2 : 0) + (c > "b" ? 4 : 0) + (c >= "b" ? 8 : 0) + ("b" < c ? 16 : 0) + ("b" <= c ? 32 : 0) + ("b" > c ? 64 : 0) + ("b" >= c ? 128 : 0); }
function relationsOfCode(s: unknown, i: unknown) { if (typeof s !== "string" || typeof i !== "number") return "other"; const c = s.charCodeAt(i); return (c < 98 ? 1 : 0) + (c <= 98 ? 2 : 0) + (c > 98 ? 4 : 0) + (c >= 98 ? 8 : 0) + (98 < c ? 16 : 0) + (98 <= c ? 32 : 0) + (98 > c ? 64 : 0) + (98 >= c ? 128 : 0) + (c === 98 ? 256 : 0) + (c === -1 ? 512 : 0) + (c > -5 ? 1024 : 0) + (c >= -1 ? 2048 : 0) + (c == 98 ? 4096 : 0); }
function sameLetter(s: unknown, t: unknown, i: unknown) { return typeof s === "string" && typeof t === "string" && typeof i === "number" ? s[i | 0] === t[i | 0] : "other"; }
function sameMixed(s: unknown, t: unknown, i: unknown) { return typeof s === "string" && typeof t === "string" && typeof i === "number" ? s[i | 0] === t.charAt(i) : "other"; }
function lengths(s: unknown) { if (typeof s !== "string") return "other"; return (s.length === 0 ? 1 : 0) + (s.length ? 2 : 0) + (s.length > 0 ? 4 : 0) + (0 < s.length ? 8 : 0) + (s.length >= 1 ? 16 : 0) + (s.length < 1 ? 32 : 0) + (s.length == 0 ? 64 : 0) + (s.length === 1 ? 128 : 0) + (s.length <= 0 ? 256 : 0) + (0 === s.length ? 512 : 0); }
function order(a: unknown, b: unknown) { if (typeof a !== "string" || typeof b !== "string") return "other"; return a < b ? -1 : a > b ? 1 : 0; }
function orderTurned(a: unknown, b: unknown) { if (typeof a !== "string" || typeof b !== "string") return "other"; return a <= b ? (b <= a ? 0 : -1) : 1; }
function verbs(s: unknown, n: number) { let c = 0; for (let i = 0; i < n; i++) { if (s === "get") c += 1; else if (s === "put") c += 10; else if (s === "post") c += 100; else if (s === "") c += 1000; } return c; }
function belowLetter(s: unknown, n: number) { if (typeof s !== "string") return "other"; let c = 0; for (let i = 0; i < n; i++) { if (s < "b") c += 1; if ("b" <= s) c += 10; if (s >= "b") c += 100; } return c; }
function loose(x: unknown) { return x == "abc"; }
function headIs(s: unknown, n: unknown) { return typeof s === "string" && typeof n === "number" ? s.slice(0, n) === "ab" : "other"; }
function tailIs(s: unknown, n: unknown) { return typeof s === "string" && typeof n === "number" ? s.slice(n) === "ab" : "other"; }
function middleIs(s: unknown, n: unknown) { return typeof s === "string" && typeof n === "number" ? s.substr(n, 2) === "ab" : "other"; }
function pieceIsEmpty(s: unknown, n: unknown) { return typeof s === "string" && typeof n === "number" ? s.slice(n, 2) === "" : "other"; }
function grown(n: number) { let text = ""; for (let i = 0; i < n; i++) text += "ab"; return text; }
const texts = ["", ",", "b", "a,b", "ab", "abab", "Ā,", "bĀ", "😀", grown(3), grown(20).slice(3, 8), "get", "put", "post", "pos" + grown(0) + "t"];
const positions = [-1, 0, 1, 2, 3, 5, 100, -2147483648, 2147483647];
for (let t = 0; t < texts.length; t++) { for (let p = 0; p < positions.length; p++) { const s = "" + texts[t]; const i = positions[p] | 0; report(isComma(s, i)); report(isBehindEnd(s, i)); report(isNoText(s, i)); report(isNothing(s, i)); report(elementIsNothing(s, i)); report(isLong(s, i)); report(relations(s, i)); report(relationsOfCharAt(s, i)); report(relationsOfCode(s, i)); report(headIs(s, i)); report(tailIs(s, i)); report(middleIs(s, i)); report(pieceIsEmpty(s, i)); } }
for (let t = 0; t < texts.length; t++) { for (let u = 0; u < texts.length; u++) { const a = "" + texts[t]; const b = "" + texts[u]; report(order(a, b)); report(orderTurned(a, b)); report(sameLetter(a, b, 1)); report(sameMixed(a, b, 1)); report(sameLetter(a, b, 9)); report(sameMixed(a, b, 9)); } }
for (let t = 0; t < texts.length; t++) { const s = "" + texts[t]; report(lengths(s)); report(verbs(s, 3)); report(belowLetter(s, 3)); report(loose(s)); }
let conversions = 0;
const hostile: unknown[] = ["abc", "ab" + grown(0) + "c", null, undefined, 0, NaN, true, 12n, ["abc"], [["abc"]], { toString() { conversions++; return "abc"; } }, { valueOf() { conversions++; return "abc"; } }, { valueOf() { conversions++; return 5; }, toString() { return "abc"; } }, {}];
for (let h = 0; h < hostile.length; h++) { report(loose(hostile[h])); report(verbs(hostile[h], 2)); }
report(conversions);
report("end");
