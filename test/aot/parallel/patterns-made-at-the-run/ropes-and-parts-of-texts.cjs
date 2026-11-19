"use strict";
const n = process.argv.length, log = [];
const made = (source, flags) => new RegExp(source.replaceAll("#", String(n)), flags);
const show = found => found === null ? "null" : JSON.stringify([...found]) + "@" + found.index + (found.groups ? JSON.stringify(found.groups) : "") + (found.indices ? JSON.stringify(found.indices) : "");
const left = "x".repeat(20 + n), right = "aab".repeat(8 + n); const pattern = made("(a{#})b"); const rope = left + right; log.push(show(pattern.exec(rope)).length, pattern.exec(left + right).index, pattern.exec((left + right).slice(3)).index, pattern.exec((left + right).substring(21, 40)).index, show(pattern.exec(left.slice(1))), pattern.exec(rope + rope).input.length);
console.log("SAID", log.join(" | "));
