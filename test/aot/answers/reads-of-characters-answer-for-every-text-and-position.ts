// answers: without-library
// # every read of a character answers as the language says, for every text and every position: inside, outside, a fraction, NaN, -0, the infinities, beyond int32; the empty text, ropes, pieces, 16 bits, pairs and lone surrogates
// # f1 = codeAt, f2 = pointAt, f3 = letterAt, f4 = relative, f5 = element, f6 = firstOfRest, f7 = secondOfPiece, f8 = sumInside, f13 = codeAtOfAnything
// # each text and position comes proven out of the driver, by its making and not by the typeof tests of the functions: "" + text is the same cell and +position the same number, so Link and the arrivals say string and number of the parameters
// # what is no text and no number goes to a function of its own, f13: handed to codeAt in plain sight it would widen what is proven of s and i, and the call would go by value
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = GetStringCodeUnit
// # RUN(POINT): walk f2 mechanisms=all
// # POINT-LABEL: code f2:Body
// # POINT: = CallInline {{*}}inlineBuiltin=StringCodePointAt
// # RUN(ELEMENT): walk f5 mechanisms=all
// # ELEMENT-LABEL: code f5:Body
// # ELEMENT: = Substring
// # RUN(PIECE): walk f6 mechanisms=all
// # PIECE-LABEL: code f6:Body
// # PIECE: = GetStringCodeUnit
// # RUN(INSIDE): walk f8 mechanisms=all
// # INSIDE-LABEL: code f8:Body
// # INSIDE: = GetStringCodeUnit
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 1606 of 1606 of 1606
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function codeAt(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s.charCodeAt(i) : "other"; }
function pointAt(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s.codePointAt(i) : "other"; }
function letterAt(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s.charAt(i) : "other"; }
function relative(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s.at(i) : "other"; }
function element(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s[i | 0] : "other"; }
function firstOfRest(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s.slice(i).charCodeAt(0) : "other"; }
function secondOfPiece(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s.substring(i, 3).charAt(1) : "other"; }
function sumInside(s: unknown) { if (typeof s !== "string") return "other"; let sum = 0; for (let i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) | 0; return sum; }
function withoutPosition(s: unknown) { if (typeof s !== "string") return "other"; const t = s as any; return t.charCodeAt() + "|" + t.charAt() + "|" + t.at() + "|" + t.codePointAt(); }
function behindTests(s: unknown, i: unknown) { if (typeof s !== "string" || typeof i !== "number") return "other"; const k = i | 0; if (k < 0) return -3; if (k >= s.length) return s.charCodeAt(k); if (s.length > k) return s.charCodeAt(k); return -2; }
function grown(n: number) { let text = ""; for (let i = 0; i < n; i++) text += "abĀ"; return text; }
function show(v: unknown) { return typeof v === "number" ? String(v) : v === undefined ? "undefined" : JSON.stringify(v); }
function codeAtOfAnything(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s.charCodeAt(i) : "other"; }
const texts = ["", "a", "héllo", "Āb", "a😀b", "\ud83d", "\ude00x", grown(5), grown(40).slice(7, 19)];
const positions = [-1, 0, 1, 2, 3, 1.5, -0.5, NaN, -0, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 11, 12, 14, 15, -12, -13];
for (let t = 0; t < texts.length; t++) { for (let p = 0; p < positions.length; p++) { const s = "" + texts[t]; const i = +positions[p]; report(show(codeAt(s, i))); report(show(pointAt(s, i))); report(show(letterAt(s, i))); report(show(relative(s, i))); report(show(element(s, i))); report(show(firstOfRest(s, i))); report(show(secondOfPiece(s, i))); report(show(behindTests(s, i))); } }
for (let t = 0; t < texts.length; t++) { const s = "" + texts[t]; report(show(sumInside(s))); report(show(withoutPosition(s))); }
report(show(codeAtOfAnything(5, 0)));
report(show(codeAtOfAnything("a", "0")));
report(show(sumInside(null)));
report("end");
