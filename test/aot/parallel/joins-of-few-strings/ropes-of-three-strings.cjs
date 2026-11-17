// A rope of three strings is joined with all three.
"use strict";
const pieces = ["a", "", "bc", "length", "é", "Ж", "long".repeat(12), "0", "abcdefghijklmnopqrstuvwxyz"];
function three(a, b, c) { return a + b + c; }
function text(a, b, c) { return `${a}-${b}-${c}`; }
function grown(a, n) { let s = a; for (let k = 0; k < n; k++) s += pieces[k % 4]; return s; }
for (let k = 0; k < 60; k++) {
  const a = pieces[k % 9] + k, b = pieces[(k * 5 + 1) % 9], c = pieces[(k * 7 + 2) % 9] + "z";
  const log = [three(a, b, c), three(c, a, b), text(a, b, c), a.concat(b, c), grown(a, k % 5), three(three(a, b, c), b, a), [a, b, c].join(""), a + (b + c), (a + b) + c, three(a, k, c), three(b + a, "x", c + b)];
  if (k & 1) log.push(k, k / 2, true, null);
  console.log(log.join(""), log.join(), log.join("+"), log.slice(0, 2).join("ab").length, log.slice(3, 5).join());
}
