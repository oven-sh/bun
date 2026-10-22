let reads = 0;
class A extends Uint8Array { constructor() { const before = reads; super(); this.delta = reads - before; } }
const T = function () {}.bind(null);
Object.defineProperty(T, "prototype", { get() { reads++; return A.prototype; } });
const o = Reflect.construct(A, [], T);
console.log(o.delta, reads, o instanceof A);
const direct = Reflect.construct(Uint8Array, [], T);
console.log(reads, direct instanceof A);
