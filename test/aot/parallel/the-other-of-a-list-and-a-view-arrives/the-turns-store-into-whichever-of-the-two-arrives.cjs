"use strict";
let held = new Float64Array(5);
function load(rows) { held = rows; }
const beside = [0, 0, 0, 0, 0], view = new Float64Array(5);
function doubled() { let s = 0; for (let i = 0; i < held.length; i++) { s = s + held[i] * 2; held[i] = held[i] + 1; } return s; }
function laidBeside() { let s = 0; for (let i = 0; i < held.length; i++) { s = s + held[i] * 2; beside[i] = held[i] + 0.5; view[i] = held[i] * 3; } return s; }
function replaced() { let s = 0; for (let i = 0; i < held.length; i++) { s = s + held[i] * 2; if (i === 1) load(i % 2 ? [9.5, 8.5, 7.5, 6.5] : Float64Array.of(1, 2, 3)); } return s; }
function grown() { let s = 0; for (let i = 0; i < held.length && i < 8; i++) { s = s + held[i] * 2; if (Array.isArray(held) && i === 2) held.push("4"); } return s; }
const parsed = JSON.parse('{"fractions":[0.5,1.5,2.5,3.5],"whole":[1,2,3,4]}');
for (let round = 0; round < 3; round++) {
  for (const make of [() => Float64Array.of(0.5, 1.5, 2.5), () => parsed.fractions.slice(), () => parsed.whole.slice(), () => Float64Array.of(4.5)]) {
    for (const run of [doubled, laidBeside, replaced, grown]) { load(make()); console.log(round, run.name, run(), Array.from(held).join(), beside.join(), view.join()); }
  }
}
