// STATISTIC: UnrolledLoopsWithSlotStores >= 1
// Under: --aot-testing=CheckBoundsInEmittersOnly: the turns are laid out as users build them, and every raw access asks its position at the run
"use strict";
// The same with the count behind the read, with a step of two, and with a sum kept in the field itself.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
class Reader { constructor(list) { this.list = list; this.n = 0; this.sum = 0; }
    go() { let s = 0; for (let i = 0; i < 40; i++) { s = (s * 31 + this.list[i]) | 0; this.n++; } return s; }
    twos() { let s = 0; for (let i = 0; i < 40; i += 2) { s = (s + this.list[i]) | 0; this.n += 2; } return s; }
    keeps() { for (let i = 0; i < 40; i++) this.sum = (this.sum + this.list[i]) | 0; return this.sum; } }
globalThis.kept = new Reader([1, 2]);
function run(list) { const reader = new Reader(list); said.push(reader.go(), reader.n, reader.twos(), reader.n, reader.keeps(), reader.sum); }
for (let round = 0; round < 3; round++) {
    const whole = []; for (let i = 0; i < 48; i++) whole.push((i * 7) & 255); run(whole);
    const holed = whole.slice(); delete holed[3]; delete holed[16]; run(holed); run(whole.slice(0, 17)); run(whole.map(x => x + 0.25));
    const values = whole.slice(); values[20] = veil("7"); run(values);
}
console.log(said.join(" "));
