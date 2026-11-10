"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
function written() { return ["pear", "apple", "fig", "date"]; }
function inOrder() { return ["a", "b", "c"]; }
for (let turn = 0; turn < 4 + more; turn++) { const first = written(), second = written().sort(), third = inOrder().sort(); said.push(first.join(), second.join(), third.join(), written().join()); second[0] = "x" + turn; third.push("d"); said.push(second.join(), third.join(), written().sort().join(), inOrder().sort().join()); }
console.log(said.join("\n"));
