function F() {}
const state = { n: 0 };
class B extends F { constructor() { const before = state.n; super(); this.delta = state.n - before; } }
const T = function () {}.bind(null);
Object.defineProperty(T, "prototype", { get() { state.n++; return B.prototype; } });
console.log(Reflect.construct(B, [], T).delta, new B().delta, state.n);
