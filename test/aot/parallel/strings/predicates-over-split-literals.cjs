// Predicates that search the words of a split literal (isKeyword of parsers) for parts of a text, joined texts, constants and what is no text.
"use strict";
function makePredicate(words) { words = words.split(" "); return function (str) { return words.indexOf(str) >= 0; }; }
function makeFrom(words, separator) { const list = words.split(separator); return { has: (str) => list.includes(str), at: (str, from) => list.indexOf(str, from), last: (str) => list.lastIndexOf(str) }; }
const isKeyword = makePredicate("break case catch continue debugger default do else finally for function if return switch throw try var while with null true false this");
const isShort = makePredicate("a b c d e f g h i"), isFew = makePredicate("one two three"), comma = makeFrom("alpha, beta, gamma, delta, epsilon, zeta, eta, theta, beta", ", ");
const text = "x break y function z returns finally; casecatch a alpha, beta two béta this thi sthis";
const out = []; let n = 0, s = 0, f = 0, c = 0;
for (let i = 0; i < text.length; i++) for (let j = 0; j < 10; j++) { const part = text.slice(i, i + j); if (isKeyword(part)) n += i + j; if (isShort(part)) s++; if (isFew(part)) f++; if (comma.has(part)) c += comma.at(part, 2) + comma.last(part); }
out.push([n, s, f, c].join());
for (const key of [text.slice(2, 7), text.slice(41, 46), "br" + "eak".slice(0), ["de", "fault"].join(""), "this", "thi" + "s".repeat(1), "", " ", "breaks", undefined, null, 5, {}, ["if"], new String("if"), Symbol.iterator, "if"]) out.push(String(typeof key === "symbol" ? "symbol" : key) + " " + [isKeyword(key), isShort(key), isFew(key), comma.has(key), comma.at(key, 1), comma.last(key)].join());
if (typeof Bun === "object") Bun.gc(true);
let again = 0; for (let i = 0; i < 2000; i++) if (isKeyword(text.slice(i % 60, i % 60 + i % 9))) again++;
out.push(again);
for (const line of out) console.log(line);
