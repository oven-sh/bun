function once(fn) { let done = false, v; return function () { if (!done) { done = true; v = fn.apply(this, arguments); } return v; }; }
const init = once(() => 42);
function f(t) { let s = 0; for (let i = 0; i < 64; i++) { s += init() + i + (t & 1); } return s & 65535; }
const n = 50; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
