const state = { n: 0 };
const P = new Proxy(function () {}, { get(target, key) { if (key === "prototype") { state.n++; return Map.prototype; } return target[key]; } });
function make(t) { const before = state.n; Reflect.construct(Map, [], t); return state.n - before; }
console.log(make(P), make(Map), state.n);
