"use strict";
function make(turn) { const made = { first: turn }; Object.defineProperty(made, "mark", { value: turn % 2 === 0 ? turn : "odd " + turn, enumerable: turn >= 0 }); made.last = turn; return made; }
let said = 0, texts = 0;
for (let turn = 0; turn < 3000; turn++) { const made = make(turn); if (typeof made.mark === "string") texts += made.mark.length; else said = (said + made.mark + made.first + made.last) % 1000003; }
console.log(said, texts, Object.keys(make(4)).join(), JSON.stringify(make(5)));
