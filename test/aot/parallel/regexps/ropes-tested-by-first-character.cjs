// A match at the start of a rope that misses by the first character leaves the rope as it is.
// COUNTER: operationAOTFlatten <= 1500
"use strict";
const letters = "qwertyuiopasdfghjklzxcvbnm0123456789\"_-";
const hide = v => [v][JSON.parse("0")];
const pieces = []; for (let i = 0; i < 40; i++) pieces.push((letters[i % letters.length] + "abcdefghij" + i).slice(0, 8));
const rope = (a, b, c) => a + (b + ":" + c);
const deep = a => { let s = a; for (let i = 0; i < 12; i++) s = s + pieces[i]; return s; };
const part = a => ("xx" + a + "yy").substring(2, 2 + a.length);
class Token { constructor(s) { this.s = s; } toString() { return "" + this.s + "\" at " + pieces[this.s.length & 7]; } }
const digits = /^[0-9]/, quoted = /^".*"/, end = /^end$/, words = /^((else)|(end)|(elsif))/i, mixed = /^(?:a|[x-z]|\d)b?/, sticky = /^e/y, global = /^e/g, lines = /^e/m, wide = /^[\u0100e]/, either = /^e|x/, optional = /^e?/;
const all = [digits, quoted, end, words, mixed, sticky, global, lines, wide, either, optional].map(hide);
const log = [];
function literals(s) { return (/^[0-9]/.test(s) ? 1 : 0) + (/^".*"/.test(s) ? 2 : 0) + (/^end/.test(s) ? 4 : 0) + (/^(?:else|elsif)/i.test(s) ? 8 : 0) + (/^\n/.test(s) ? 16 : 0) + (/^_([a-z]*)/.exec(s) ? 32 : 0) + (s.match(/^-/) ? 64 : 0); }
function held(s) { let n = 0; for (let i = 0; i < all.length; i++) { if (all[i].test(s)) n += 1 << i; if (all[i].exec(s)) n += 1 << i + 11; all[i].lastIndex = 0; } return n + "/" + (/^[\u017f\u212a]/iu.test(s) ? 1 : 0) + s.search(/^q/); }
let sum = 0;
for (let i = 0; i < 2000; i++) sum = (sum * 31 + literals(rope(pieces[i % 40], pieces[i % 7], i)) + (/^"/.test(new Token(pieces[i % 40])) ? 7 : 0)) | 0;
log.push(sum);
for (const a of ["", "e", "end", "END", "1", "\"q\"", "\u00e9", "\u0100", "\u017f", "\n", "_a", "-", "x", "q", ...pieces.slice(0, 5)]) {
  for (const s of [rope(a, "b", "c"), rope(a, "", ""), deep(a), part(a), part(rope(a, "b", "c")), a + "\u0101", rope(part(a), part("b"), 1), a, a + (a + a)])
    log.push(literals(s) + "." + held(s));
}
log.push(held(rope("e", "n", "d")), literals(rope("end", "", "")));
digits.lastIndex = 3; log.push(digits.test(rope("a", 1, 2)), digits.lastIndex, sticky.test(rope("a", 1, 2)), sticky.lastIndex);
sticky.lastIndex = 1; log.push(sticky.test(rope("ae", 1, 2)), sticky.lastIndex); global.lastIndex = 1; log.push(global.test(rope("ae", 1, 2)), global.lastIndex);
digits.lastIndex = { valueOf() { log.push("asked"); return 0; } }; log.push(digits.test(rope("a", 1, 2)), digits.test(rope("1", 1, 2)));
digits.compile("^a"); digits.lastIndex = 0; log.push(digits.test(rope("a", 1, 2)), digits.test(rope("1", 1, 2)));
log.push(RegExp.lastMatch, "x".replace(/x/, "y"), /^e/.test(rope("a", 1, 2)), RegExp.lastMatch, /^a/.test(rope("a", 1, 2)), RegExp.lastMatch + RegExp.rightContext);
console.log(log.join(" "));
