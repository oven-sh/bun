"use strict";
// STATISTIC: SwitchesThatAskLengthsOfRopesInFront >= 1
// A text grows by a letter, narrow or wide, in a field and in a local, and is switched over in each turn: by few and by many cases, short, long, empty, beyond what the stub writes down.
const o = JSON.parse('{"t":""}'), A = JSON.parse('"abcdefg\\n"'), U = JSON.parse('"ab\\u4e2dd"');
const L = "abcdefg\nabcdefg\nabc", M = "abcdefg\n".repeat(17).slice(0, 130);
function few(n, from) { o.t = ""; let s = ""; for (let i = 0; i < n; i++) { o.t += from[i % from.length]; switch (o.t) { case "abc": s += 3; break; case "abcd": s += 4; break; case "ab": s += 2; break; default: s += "."; } } return s; }
function many(n, from) { let x = "", s = ""; for (let i = 0; i < n; i++) { switch (x) { case "": s += "e"; break; case "a": s += 1; break; case "abcdefg\nabcdefg\nabc": s += "L"; break; case "abcdefg\n": s += 8; break; case "abcdefg\nabcdefg\nabcdefg\nabcdefg\nabcdefg\nabcdefg\nabcdefg\nabcdefg\nabcdefg\nabcdefg\nabcdefg\nabcdefg\nabcdefg\nabcdefg\nabcdefg\nabcdefg\nab": s += "M"; break; default: s += "."; } x = x + from[i % from.length]; } return s; }
function others(list) { let s = ""; for (let i = 0; i < list.length; i++) switch (list[i]) { case "abc": s += 1; break; case "ab": s += 2; break; case "abcd": s += 3; break; default: s += 0; } return s; }
let last = "";
for (let round = 0; round < 4; round++) last = [few(5, A), few(140, A), few(9, U), many(22, A), many(140, A), many(9, U), others(["abc", "ab" + A[2], A.slice(0, 3), A.slice(0, 4), ("x" + A).slice(1, 3), U.slice(0, 2), "", 0, null, undefined, {}, ["abc"], new String("abc"), 5n, "ab" + U[2], L, M])].join("|");
console.log(last);
