// A loop calls a function that it reads out of a field of `this` in every turn; the program stores few closures there, all by the field's name. The compiler may read the field once in front of the loop, tell the closure apart there and run a copy of the loop with that closure's body in line. HERE: a number is stored into the field by its name: the call throws.
"use strict";
const log = [];
class Shelf {
    constructor(order) { this.order = order; this.top = null; this.sign = 1; }
    put(key) {
        const node = { key, low: null, high: null };
        if (!this.top) { this.top = node; return; }
        let at = this.top;
        for (;;) {
            const c = this.order(key, at.key);
            if (c === 0) return;
            const next = c < 0 ? at.low : at.high;
            if (!next) { if (c < 0) at.low = node; else at.high = node; return; }
            at = next;
        }
    }
    depth(key) {
        let at = this.top, n = 0;
        while (at) {
            n++;
            const c = this.order(key, at.key);
            if (c === 0) return n;
            at = c < 0 ? at.low : at.high;
        }
        return -n;
    }
}
const byNumber = (a, b) => a - b;
const numbers = [8, 4, 12, 2, 6, 10, 14, 1, 3, 5, 7, 9, 11, 13, 15];
function fill(shelf) { for (const key of numbers) shelf.put(key); return shelf; }
function tell(run) { try { return String(run()); } catch (error) { return error.constructor.name + ": " + error.message; } }
let left = 0, turncoat = null;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const rounds = +process.argv[2] || 3;
for (let round = 0; round < rounds; round++) {
    const plain = fill(new Shelf(byNumber));
    console.log(round, tell(() => [1, 8, 15, 16, 0, 5.5].map(k => plain.depth(k)).join()));
    log.length = 0;
    console.log(round, tell(() => { const s = fill(new Shelf(byNumber)); const t = new Shelf(byText); t.put("m"); t.put("c"); const a = t.depth("c"); s.order = 7; return a + " " + s.depth(5); }), "|", log.join(";"));
}
