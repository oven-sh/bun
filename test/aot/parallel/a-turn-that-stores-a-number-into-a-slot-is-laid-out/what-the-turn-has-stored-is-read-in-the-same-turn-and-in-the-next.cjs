// STATISTIC: UnrolledLoopsWithSlotStores >= 1
"use strict";
// The slot that the turn stores is read again in the turn, in the next turn, through a second name of the same object, and as the loop's own bound.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
class Reader { constructor(list) { this.list = list; this.n = 0; this.m = 0; }
    again() { let s = 0; for (let i = 0; i < 40; i++) { this.n++; s = (s + this.n + this.list[i]) | 0; } return s; }
    other(that) { let s = 0; for (let i = 0; i < 40; i++) { this.n++; s = (s + that.n + this.list[i]) | 0; } return s; }
    both(that) { let s = 0; for (let i = 0; i < 40; i++) { this.n++; that.n += 2; s = (s + this.list[i]) | 0; } return s; }
    bound() { let s = 0; for (let i = 0; i < this.m; i++) { this.m = (this.m - 1) | 0; s = (s + this.list[i]) | 0; } return s; } }
globalThis.kept = new Reader([1, 2]);
const whole = []; for (let i = 0; i < 48; i++) whole.push((i * 7) & 255);
for (let round = 0; round < 3; round++) {
    const one = new Reader(whole), two = new Reader(whole);
    said.push(one.again(), one.n, one.other(two), one.other(one), one.n, two.n, one.both(two), one.both(one), one.n, two.n);
    one.m = 40; said.push(one.bound(), one.m);
}
console.log(said.join(" "));
