const n = 140000;
class Heir extends Array<number> {}
class Other extends Array<number> { static get [Symbol.species]() { return Array; } }
function fill<T extends number[]>(list: T): T { for (let i = 0; i < n; i++) list.push(i); return list; }
const a = fill(new Heir()); const ra = a.splice(1, 2); const b = fill(new Other()); const rb = b.splice(1, 2, -1, -2, -3);
console.log(a.length, a[0], a[1], ra instanceof Heir, ra.join(), b.length, b[0], b[1], b[4], rb instanceof Other, Array.isArray(rb), rb.join());
