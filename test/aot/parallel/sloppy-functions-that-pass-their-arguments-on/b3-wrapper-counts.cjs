var calls = 0; function wrap(fn) { return function () { calls++; return fn.apply(this, arguments); }; } var h = wrap(function (x) { return x + 1; });
function f(t) { var s = 0; for (var i = 0; i < 64; i++) s += h(i + t); return s; }
const n = 50; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
