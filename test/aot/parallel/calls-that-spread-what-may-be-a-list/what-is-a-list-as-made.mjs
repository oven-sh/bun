function three(a, b, c) { return a + "/" + b + "/" + c; }
function run(xs, n) { const out = []; for (let i = 0; i < n; i++) out[i] = three(...xs); return out[n - 1]; }
class Twice extends Array { *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield this[i] * 2; } }
class Bare extends Array {}
const base = JSON.parse("[1,2,3]"), turns = JSON.parse("2");
const own = base.slice(); own[Symbol.iterator] = function* () { yield "o"; };
const holed = base.slice(); delete holed[1];
const above = base.slice(); delete above[1]; Object.setPrototypeOf(above, Object.create(Array.prototype, { 1: { value: "up", configurable: true } }));
const computed = base.slice(); Object.defineProperty(computed, 1, { get() { return "got"; }, configurable: true, enumerable: true });
console.log(`SAID ${run(Twice.from(base), turns)} ${run(Bare.from(base), turns)} ${run(own, turns)} ${run(holed, turns)} ${run(above, turns)} ${run(computed, turns)} ${run(Object.freeze(base.slice()), turns)}`);
