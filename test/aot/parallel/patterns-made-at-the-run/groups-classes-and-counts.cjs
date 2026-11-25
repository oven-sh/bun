"use strict";
const n = process.argv.length, log = [];
const made = (source, flags) => new RegExp(source.replaceAll("#", String(n)), flags);
const show = found => found === null ? "null" : JSON.stringify([...found]) + "@" + found.index + (found.groups ? JSON.stringify(found.groups) : "") + (found.indices ? JSON.stringify(found.indices) : "");
for (const [source, text] of [["^(a{#})(b+)?c", "aabbc"], ["^(a{#})(b+)?c", "aac"], ["^(a{#})(b+)?c", "abc"], ["(\\\\d+)-(\\\\d{#})", "x 12-345 y"], ["[^/]+/([^/]{#,})$", "ab/cdef"], ["(x|yy|z{#})+", "wxyyzzx"], ["", "abc"], ["a{#}", ""], ["^$", ""], ["\\\\bfoo#\\\\b", "a foo2 b"], ["(?:a|(b))+c{#}", "abacc"]]) for (let turn = 0; turn < 3; turn++) log.push(show(made(source).exec(text)));
console.log("SAID", log.join(" | "));
