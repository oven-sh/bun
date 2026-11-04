const first = (k) => k + 40;
const second = (v) => v + 50;
function Pair(k, v) { this.k = k; this.v = v; }
Object.defineProperty(Pair.prototype, 0, { get() { return first(this.k); } });
Object.defineProperty(Pair.prototype, "1", { get() { return second(this.v); } });
const make = (k, v) => new Pair(k, v);
const like = make(3, 4); like.length = 2;
try {
const out = new Uint8Array(like);
console.log(out.length, out[0] + out[1]);
} catch (error) { console.log(error.constructor.name); }
