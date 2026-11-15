// A loop that goes by the protocol alone keeps its iterator and `next` in values of the frame. Here the frame is a generator's, and it is closed, thrown into and run to its end from outside while it stands in the body.
class Row { constructor(n, log) { this.n = n; this.log = log; } [Symbol.iterator]() { let i = 0; const n = this.n, log = this.log; return { next() { log.push("n" + i); return i < n ? { done: false, value: i++ } : { done: true, value: undefined }; }, return() { log.push("r" + i); return {}; } }; } }
function* relay(row) { for (const v of row) { const junk = []; for (let k = 0; k < 50; k++) junk.push({ k }); yield v * 10 + junk.length; } return "end"; }
function drive(mode) { const log = []; const g = relay(new Row(3, log)); let out = g.next().value + "," + g.next().value + ","; try { const r = mode === 0 ? g.return("bye") : mode === 1 ? g.throw(new RangeError("stop")) : g.next(); out += r.value + ":" + r.done; } catch (e) { out += e.name; } return out + "|" + g.next().done + " " + log.join(""); }
let last = ""; for (let t = 0; t < 300; t++) last = drive(t % 3);
console.log(drive(0), drive(1), drive(2), last);
