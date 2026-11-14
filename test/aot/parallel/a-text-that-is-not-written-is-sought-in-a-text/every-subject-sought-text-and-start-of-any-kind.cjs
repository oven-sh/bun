"use strict";
const subjects = JSON.parse('["", "a", ":", "a:b", "::", "alpha:beta:gamma", "no delimiter here", "\\u00e9t\\u00e9:\\u00ff", "\\u0416:\\u0416", "tail:"]').concat(["x".repeat(31) + ":", "x".repeat(32) + ":", "x".repeat(33) + ":", "x".repeat(300) + ":" + "y".repeat(300), ("left" + Math.abs(-1)) + (":right" + Math.abs(-2)), "0123456789:".slice(3), "ab:cd".substring(1, 4)]);
const needles = JSON.parse('["", ":", "a", "\\u00ff", "\\u00e9", "\\u0416", "::", "a:", "x", "y", "\\u0000", "delimiter", "1"]').concat([String.fromCharCode(58), ":;".slice(0, 1), "a" + ""]);
const starts = [undefined, 0, 1, 2, 3, -1, -Infinity, Infinity, NaN, 31, 32, 33, 34, 300, 301, 302, 601, 602, 1e10, 2147483647, 2147483648, 4294967296, 0.9, 1.5, "1", null];
function find(subject, needle, start) { return subject.indexOf(needle, start); }
let sum = 0, said = [];
for (const subject of subjects) for (const needle of needles) { let row = ""; for (const start of starts) { const at = find(subject, needle, start); row += at + ","; sum = (sum * 31 + at + 7) % 1000003; } said.push(row); }
console.log(sum); console.log(said.slice(0, 40).join("\n")); console.log(said.slice(-40).join("\n"));
