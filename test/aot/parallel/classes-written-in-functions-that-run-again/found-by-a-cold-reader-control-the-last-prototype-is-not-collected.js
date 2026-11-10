"use strict";
const unseen = (x) => [x][JSON.parse("0")], count = JSON.parse("1");
function makeOften() { return class Often { constructor(n) { this.size = n; } }; }
function makeLate() { return class Late { constructor(n) { this.a = n; this.b = n + 1; this.c = n + 2; } }; }
function lay() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return makeOften().name.length + work; }
function late(turns) {
  let text = "";
  for (let turn = 0; turn < turns; turn++) { const Late = makeLate(), seen = unseen(new Late(turn)); text += Object.keys(seen).join() + ":" + (seen.a + seen.b + seen.c) + ":" + (seen instanceof Late); }
  return text;
}
let sum = 0;
for (let turn = 0; turn < 8; turn++) { sum += lay(); if (turn < 7) Bun.gc(true); }
console.log(sum, late(count));
