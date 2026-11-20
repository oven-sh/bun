"use strict";
// The turn lays another list into the field, cuts the list, stores into it; the position itself lives in the field.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
class Reader { constructor(list) { this.list = list; this.n = 0; this.pos = 0; }
    swaps(other) { let s = 0; for (let i = 0; i < 40; i++) { this.n++; if (i === 9) this.list = other; s = (s * 31 + this.list[i]) | 0; } return s; }
    cuts() { let s = 0; for (let i = 0; i < 40; i++) { this.n++; if (i === 9) this.list.length = 12; s = (s * 31 + this.list[i]) | 0; } return s; }
    stores() { let s = 0; for (let i = 0; i < 40; i++) { this.n++; this.list[(i + 1) % 40] = 0.5; s = (s * 31 + this.list[i]) | 0; } return s; }
    walks() { let s = 0; do { s = (s * 31 + this.list[this.pos++]) | 0; } while (this.pos < 40); return s; } }
globalThis.kept = new Reader([1, 2]);
for (let round = 0; round < 3; round++) {
    const make = () => { const whole = []; for (let i = 0; i < 48; i++) whole.push((i * 7) & 255); return whole; };
    let reader = new Reader(make()); said.push(reader.swaps(make().map(x => x + 0.5)), reader.n); reader = new Reader(make()); said.push(reader.swaps(veil(["a"])), reader.n);
    reader = new Reader(make()); said.push(reader.cuts(), reader.n); reader = new Reader(make()); said.push(reader.stores(), reader.n); reader = new Reader(make()); said.push(reader.walks(), reader.pos);
}
console.log(said.join(" "));
