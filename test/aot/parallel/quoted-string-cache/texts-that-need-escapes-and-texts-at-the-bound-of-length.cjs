"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const bag = {};
const names = ["", "a", "say \"hi\"", "back\\slash", "line\nfeed", "tab\t", "\u0000", "\u001f", "\u007f", "caf\u00e9", "\u00ff", "snow\u2603", "\ud800", "x".repeat(31), "x".repeat(32), "x".repeat(33), "x".repeat(64), "</script>", "\u2028"];
for (const name of names) bag[name] = more;
for (let turn = 0; turn < 3; turn++) for (const key of Object.keys(bag)) said.push(JSON.stringify(key) + " " + JSON.stringify(key).length);
console.log(said.join("\n"));
