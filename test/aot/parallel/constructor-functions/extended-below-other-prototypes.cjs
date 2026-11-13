// A function that runs several times makes a constructor each time. Its objects lie below Object.prototype first and are extended, so the next ones are born with a spare word behind their fields.
function key(a, b) { return a + b; }
function extend(o, k, v) { o[k] = v; return o; }
for (const other of JSON.parse('[{"other":1},[2]]')) extend(other, key("x", 1), 3);
function factory(n) {
  function Made(k, last) { this.number = k; this.last = last; }
  Made.prototype.m = function () { return "m" + n; };
  return { Made, a(k) { return new Made(k, null); }, b(k) { return new Made(k, "b"); }, c(k) { return new Made(k, k); }, d(k, l) { return new Made(k, l); } };
}
function make(C, k, l) { return new C(k, l); }
function below(C, k, l) { const p = C.prototype; C.prototype = 5; const o = new C(k, l); C.prototype = p; return o; }
const lines = [];
function show(o, C) { lines.push([typeof o.m === "function" ? o.m() : "none", Object.getPrototypeOf(o) === C.prototype, Object.keys(o).join()].join(" ")); }
const first = factory(1), second = factory(2);
for (let i = 0; i < 2000; i++) { const o = below(first.Made, i, i); if (i > 1) extend(o, key("x", i % 2), i); if (i > 1997) show(o, first.Made); }
for (let i = 0; i < 4; i++) { show(make(first.Made, i, i), first.Made); show(make(second.Made, i, i), second.Made); show(extend(make(first.Made, i, i), key("x", i), i), first.Made); }
show(first.a(1), first.Made); show(second.b(2), second.Made); show(first.c(3), first.Made); show(second.d(4, 1), second.Made);
console.log(lines.join("\n"));
