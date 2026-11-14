"use strict";
// Behind `this.n++` the turn breaks, returns, throws, or goes on to the next turn: whoever looks at the count then finds each turn counted once.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
class Reader { constructor(list) { this.list = list; this.n = 0; }
    breaks(at) { let s = 0; for (let i = 0; i < 40; i++) { this.n++; if (i === at) break; s = (s * 31 + this.list[i]) | 0; } return s; }
    returns(what) { let s = 0; for (let i = 0; i < 40; i++) { this.n++; if (this.list[i] === what) return s; s = (s * 31 + this.list[i]) | 0; } return s; }
    throws(at) { let s = 0; for (let i = 0; i < 40; i++) { this.n++; if (i === at) throw s; s = (s * 31 + this.list[i]) | 0; } return s; }
    skips() { let s = 0; for (let i = 0; i < 40; i++) { this.n++; if (this.list[i] & 1) continue; s = (s * 31 + this.list[i]) | 0; } return s; }
    either() { let s = 0; for (let i = 0; i < 40; i++) { this.n++; if (this.list[i] & 1) s = (s + 1) | 0; else s = (s * 31 + this.list[i]) | 0; } return s; } }
globalThis.kept = new Reader([1, 2]);
const whole = []; for (let i = 0; i < 48; i++) whole.push((i * 7) & 255);
for (let round = 0; round < 3; round++) {
    for (const at of veil([0, 1, 7, 8, 9, 20, 39, 40])) {
        let reader = new Reader(whole); said.push(reader.breaks(at), reader.n);
        reader = new Reader(whole); said.push(reader.returns(whole[at]), reader.n);
        reader = new Reader(whole); let thrown; try { thrown = reader.throws(at); } catch (error) { thrown = error; } said.push(thrown, reader.n);
    }
    let reader = new Reader(whole); said.push(reader.skips(), reader.n, reader.either(), reader.n);
}
console.log(said.join(" "));
