// STATISTIC: UnrolledLoopsWithSlotStores >= 1
"use strict";
// `this.n++` stands in front of the read. A turn that the generator leaves is run again from its start: the count must not be taken twice where the list has a hole, ends early, or holds doubles.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
class Reader { constructor(list) { this.list = list; this.n = 0; } go() { let s = 0; for (let i = 0; i < 40; i++) { this.n++; s = (s * 31 + this.list[i]) | 0; } return s; } }
globalThis.kept = new Reader([1, 2]);
function run(list) { const reader = new Reader(list); const s = reader.go(); said.push(s, reader.n); }
for (let round = 0; round < 3; round++) {
    const whole = []; for (let i = 0; i < 48; i++) whole.push((i * 7) & 255); run(whole);
    const holed = whole.slice(); delete holed[0]; run(holed); delete holed[7]; run(holed); delete holed[8]; delete holed[39]; run(holed);
    const short = whole.slice(0, 39); run(short); run(whole.slice(0, 8)); run(whole.slice(0, 1)); run([]);
    const doubles = whole.map(x => x + 0.5); run(doubles); doubles[9] = veil(NaN); doubles[10] = veil(-0); delete doubles[11]; run(doubles);
    const values = whole.slice(); values[5] = veil("x"); run(values); values[5] = veil(null); run(values); values[5] = veil({ valueOf() { return 3; } }); run(values);
}
console.log(said.join(" "));
