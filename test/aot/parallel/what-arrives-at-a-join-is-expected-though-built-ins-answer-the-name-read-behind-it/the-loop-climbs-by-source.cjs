"use strict";
function Rung(kind, above) { this.kind = kind; this.marks = 0; this.source = above; this.other = null; this.held = null; }
const lamp = { on: null };
function climb(from) {
  let found = 0;
  for (var rung = from; rung !== null;) {
    if (rung.kind === 7) found += rung.other === null ? 3 : 2;
    else if (rung === lamp.on) found += 1;
    rung = rung.source;
    if (typeof rung !== "object") break;
  }
  return found;
}
const table = { climb }, key = ["cli", "mb"].join("");
let top = null; for (let i = 0; i < 60; i++) top = new Rung(i % 12, top);
lamp.on = top;
const parsed = JSON.parse('{ "kind": 7, "other": 1 }'); parsed[["source"].join("")] = top;
const others = [parsed, /a/, JSON.parse("{}")];
let said = /ab/.source.length;
for (let turn = 0; turn < 3000; turn++) said = (said + (turn % 500 === 499 ? table[key](others[(turn / 500 | 0) % others.length]) : climb(top))) % 1000003;
console.log(said);
