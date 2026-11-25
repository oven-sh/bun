"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const texts = JSON.parse('["pear,apple,fig", "b a c", "one", "z,y,x,w,v"]');
for (let turn = 0; turn < 4 + more; turn++) for (const text of texts) { const pieces = text.split(text.includes(",") ? "," : " "); const sorted = text.split(text.includes(",") ? "," : " ").sort(); said.push(pieces.join("+"), sorted.join("+")); sorted.push("q"); }
console.log(said.join("\n"));
