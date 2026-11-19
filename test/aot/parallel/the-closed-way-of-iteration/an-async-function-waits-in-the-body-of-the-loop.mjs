// A loop that goes by the protocol alone keeps its iterator and `next` in values of the frame. Here the frame is an async function's that waits in the body: for a value, and for a rejection that leaves the loop.
class Row { constructor(n, log) { this.n = n; this.log = log; } [Symbol.iterator]() { let i = 0; const n = this.n, log = this.log; return { next() { log.push("n" + i); return i < n ? { done: false, value: i++ } : { done: true, value: undefined }; }, return() { log.push("r" + i); return {}; } }; } }
async function pump(row, bad) { let sum = 0; for (const v of row) { sum += await (v === bad ? Promise.reject(new RangeError("turn")) : v); if (sum > 2) break; } return sum; }
async function tell(bad) { const log = []; let out; try { out = String(await pump(new Row(5, log), bad)); } catch (e) { out = e.name; } return out + log.join(""); }
let last = ""; for (let t = 0; t < 300; t++) last = await tell(t & 1 ? 1 : -1);
console.log(await tell(-1), await tell(1), last);
