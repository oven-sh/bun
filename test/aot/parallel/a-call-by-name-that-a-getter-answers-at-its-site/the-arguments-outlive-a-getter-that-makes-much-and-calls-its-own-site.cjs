"use strict";
const key = JSON.parse('"join"');
let depth = 0, made = 0;
const table = Object.defineProperty({}, key, {
  get() {
    const waste = []; for (let at = 0; at < 40; at++) waste.push({ at, text: "w" + at, list: [at, at + 1] }); made += waste.length;
    if (depth < 3) { depth++; const below = call(depth, waste.length); depth--; if (below.length < 3) throw new Error("short"); }
    return (list, record, text, pick) => list[0] + ":" + record.v + ":" + text + ":" + pick(list.length);
  }, configurable: true });
function call(i, more) { const list = [i, more], record = { v: i * 2 }, text = "t" + i, pick = size => size + i; return table.join(list, record, text, pick); }
function drive(turns) { let length = 0, last = ""; for (let i = 0; i < turns; i++) { last = call(i, 0); length += last.length; } return length + " " + last + " " + made; }
console.log(drive(+(process.argv[2] ?? 4000)));
