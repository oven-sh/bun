"use strict";
const n = process.argv.length, log = [];
const made = (source, flags) => new RegExp(source.replaceAll("#", String(n)), flags);
const show = found => found === null ? "null" : JSON.stringify([...found]) + "@" + found.index + (found.groups ? JSON.stringify(found.groups) : "") + (found.indices ? JSON.stringify(found.indices) : "");
for (const [source, flags, text] of [["(?<year>\\\\d{4})-(?<month>\\\\d{#})", "", "on 2026-11-06"], ["(?<a>x)|(?<b>y{#})", "", "zyy"], ["(a)(b{#})?", "d", "xabbz"], ["(?<k>k{#})", "d", "akkb"]]) { const pattern = made(source, flags); for (let turn = 0; turn < 3; turn++) log.push(show(pattern.exec(text))); }
console.log("SAID", log.join(" | "));
