"use strict";
// The sum lives in the field; behind its store the turn throws, breaks or returns at a turn that the caller names. A way out of a turn laid out is taken by running the turn again: the store may not be made twice.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
class Tally { constructor(step) { this.total = 0; this.step = step; }
    throws(at) { for (let i = 0; i < 100; i++) { this.total = (this.total + i * this.step) | 0; if (i === at) throw i; } return -1; }
    breaks(at) { let i = 0; for (; i < 100; i++) { this.total = (this.total + i * this.step) | 0; if (i === at) break; } return i; }
    returns(at) { for (let i = 0; i < 100; i++) { this.total = (this.total + i * this.step) | 0; if (i === at) return i; } return -1; }
    counts(at) { for (let i = 0; i < 100; i++) { this.total++; if (i === at) return i; } return -1; } }
globalThis.kept = new Tally(1);
for (let round = 0; round < 3; round++) {
    for (const at of veil([0, 1, 6, 7, 8, 9, 50, 98, 99, 100])) {
        let tally = new Tally(3), thrown; try { thrown = tally.throws(at); } catch (error) { thrown = error; } said.push(thrown, tally.total);
        tally = new Tally(3); said.push(tally.breaks(at), tally.total); tally = new Tally(3); said.push(tally.returns(at), tally.total); tally = new Tally(3); said.push(tally.counts(at), tally.total);
    }
}
console.log(said.join(" "));
