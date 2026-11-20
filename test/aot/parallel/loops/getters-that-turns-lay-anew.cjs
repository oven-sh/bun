'use strict';
// A loop reads a field through a getter of the class: the getter is laid anew between the turns and by a turn, the object is an heir's, has the name itself, or is something else; a view that the getter gives is let go of.
class Store { constructor(n) { this.kept = new Float64Array(n); this.count = n; } get values() { return this.kept; } get last() { return this.count - 1; } }
class Deeper extends Store { get values() { return super.values.subarray(1); } }
const total = (store, until) => { let s = 0; for (let i = 0; i <= store.last && i < until; i++) s += store.values[i] * 2; return s; };
const put = (store, v) => { for (let i = 0; i <= store.last; i++) store.values[i] = v + i; return store; };
const say = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const own = Object.getOwnPropertyDescriptors(Store.prototype);
for (let i = 0; i < 80; i++) total(put(new Store(30), i), 30);
console.log(total(put(new Store(12), .5), 99), total(put(new Deeper(12), 1), 99), say(() => total({ values: [1, 2, 3], last: 2 }, 9)), say(() => total({ last: 2 }, 9)), say(() => total(null, 1)));
const mine = put(new Store(6), 3);
Object.defineProperty(mine, 'last', { value: 2 }); console.log(total(mine, 9));
let asked = 0;
Object.defineProperty(Store.prototype, 'values', { configurable: true, get() { asked++; if (asked === 4) this.kept = new Float32Array([9, 8, 7]); return this.kept; } });
console.log(total(put(new Store(5), 1), 9), asked); asked = 100; console.log(total(mine, 9), asked);
Object.defineProperties(Store.prototype, own); console.log(total(mine, 9));
Object.defineProperty(Store.prototype, 'last', { configurable: true, get() { if (this.count === 4) Object.defineProperty(Store.prototype, 'values', { configurable: true, get() { return ['t', 'u', 'v', 'w', 'x']; } }); return this.count - 1; } });
console.log(total(new Store(3), 9), say(() => total(new Store(4), 9))); Object.defineProperties(Store.prototype, own);
const lost = put(new Store(8), 2); structuredClone(lost.kept.buffer, { transfer: [lost.kept.buffer] }); console.log(total(lost, 9), lost.values.length, say(() => put(lost, 1).values.length));
delete Store.prototype.values; console.log(say(() => total(mine, 9))); Store.prototype.values = [4, 4, 4, 4]; console.log(say(() => total(mine, 9)), say(() => total(new Deeper(2), 9)));
