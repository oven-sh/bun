// answers: without-library
// # slice, substring and substr by two bounds and one cut, the searches for a written text, a RegExp that is one text, a test against two joined texts and a number read off a piece answer as the methods do, for every pair of bounds
// # f1 = sliced, f2 = cut, f3 = taken, f5 = written, f7 = ends, f8 = places, f10 = matches, f11 = under, f12 = amounts
// # each text and bound comes proven out of the driver, by its making and not by the typeof tests of the functions: "" + text is the same cell and +bound the same number, so Link and the arrivals say string and number of the parameters
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = StringRange
// # FORM: = Substring
// # RUN(ENDS): walk f7 mechanisms=all
// # ENDS-LABEL: code f7:Body
// # ENDS: = StringStartsWithLiteral
// # ENDS: = StringEndsWithLiteral
// # RUN(PLACES): walk f8 mechanisms=all
// # PLACES-LABEL: code f8:Body
// # PLACES: = StringIndexOfCharacter
// # PLACES: = StringLastIndexOfLiteral
// # RUN(MATCHES): walk f10 mechanisms=all
// # MATCHES-LABEL: code f10:Body
// # MATCHES: = StringIndexOfLiteral {{*}}literal="ab"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 16423 of 16423 of 16423
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function sliced(s: unknown, a: unknown, b: unknown) { return typeof s === "string" && typeof a === "number" && typeof b === "number" ? s.slice(a, b) : "other"; }
function cut(s: unknown, a: unknown, b: unknown) { return typeof s === "string" && typeof a === "number" && typeof b === "number" ? s.substring(a, b) : "other"; }
function taken(s: unknown, a: unknown, b: unknown) { return typeof s === "string" && typeof a === "number" && typeof b === "number" ? s.substr(a, b) : "other"; }
function rest(s: unknown, a: unknown) { return typeof s === "string" && typeof a === "number" ? s.slice(a) + "|" + s.substring(a) + "|" + s.substr(a) : "other"; }
function written(s: unknown) { return typeof s === "string" ? s.slice(1) + "|" + s.slice(-2) + "|" + s.slice(0) + "|" + s.slice(2, 1) + "|" + s.substring(2, 1) + "|" + s.substr(-3, 2) + "|" + s.slice(0, -1) + "|" + s.substring(-4) + "|" + s.slice(1, undefined) + "|" + s.slice() : "other"; }
function lengthOfPiece(s: unknown, a: unknown, b: unknown) { return typeof s === "string" && typeof a === "number" && typeof b === "number" ? s.slice(a, b).length : "other"; }
function ends(s: unknown) { return typeof s === "string" ? (s.startsWith("ab") ? 1 : 0) + (s.endsWith("ab") ? 2 : 0) + (s.startsWith("a") ? 4 : 0) + (s.endsWith("b") ? 8 : 0) + (s.startsWith("") ? 16 : 0) + (s.endsWith("") ? 32 : 0) + (s.startsWith("Ā") ? 64 : 0) + (s.endsWith("Āb") ? 128 : 0) : "other"; }
function places(s: unknown) { return typeof s === "string" ? s.indexOf("b") + "|" + s.indexOf("ab") + "|" + s.lastIndexOf("b") + "|" + s.lastIndexOf("ab") + "|" + s.includes("ba") + "|" + s.includes("Ā") + "|" + s.indexOf("") + "|" + s.lastIndexOf("") + "|" + s.includes("") : "other"; }
function placesFrom(s: unknown, i: unknown) { return typeof s === "string" && typeof i === "number" ? s.indexOf("b", i) + "|" + s.indexOf("ab", i) + "|" + s.includes("ab", i) + "|" + s.lastIndexOf("ab", i | 0) + "|" + s.lastIndexOf("b", i | 0) : "other"; }
function matches(s: unknown) { return typeof s === "string" ? (/ab/.test(s) ? 1 : 0) + "|" + s.search(/ba/) + "|" + (/a\.b/.test(s) ? 1 : 0) + "|" + (/AB/i.test(s) ? 1 : 0) + "|" + s.search(/b/) : "other"; }
function under(path: unknown, dir: unknown, n: number) { if (typeof path !== "string" || typeof dir !== "string") return "other"; let c = 0; for (let i = 0; i < n; i++) { if (path.startsWith(dir + "/")) c += 1; if (path.endsWith("." + dir)) c += 10; } return c; }
function amounts(s: unknown, a: unknown) { return typeof s === "string" && typeof a === "number" ? +s.slice(a) + "|" + Number(s.substring(a, 4)) + "|" + parseInt(s.slice(a), 16) + "|" + parseInt(s.slice(a, 3)) : "other"; }
function grown(n: number) { let text = ""; for (let i = 0; i < n; i++) text += "ab"; return text; }
const texts = ["", "a", "ab", "ba", "abab", "a.b", "Āb", "abĀb", grown(4), grown(30).slice(5, 12), "12", " 12 ", "0x1f", "1e3", "12px", "-7", "ff"];
const bounds = [-100, -3, -1, 0, 1, 2, 3, 100, 1.5, -1.5, NaN, Infinity, -Infinity, 2147483648, -2147483649];
for (let t = 0; t < texts.length; t++) { const s = "" + texts[t]; for (let a = 0; a < bounds.length; a++) { const first = +bounds[a]; for (let b = 0; b < bounds.length; b++) { const second = +bounds[b]; report(sliced(s, first, second)); report(cut(s, first, second)); report(taken(s, first, second)); report(lengthOfPiece(s, first, second)); } report(rest(s, first)); report(placesFrom(s, first)); report(amounts(s, first)); } }
for (let t = 0; t < texts.length; t++) { const s = "" + texts[t]; report(written(s)); report(ends(s)); report(places(s)); report(matches(s)); for (let u = 0; u < texts.length; u++) { const other = "" + texts[u]; report(under(s + "/" + other, s, 2) + "|" + under(s + "." + other, other, 2) + "|" + under(s, other, 2)); } }
report("end");
