const make = x => new Array(x), call = x => Array(x), say = f => { try { const a = f(); return a.length + ":" + (0 in a) + ":" + String(a[0]); } catch (e) { return e.name; } };
for (const f of [make, call]) console.log([3, 0, -0, "3", true, null, undefined, 3n].map(x => say(() => f(x))).join(" "));
console.log([-1, 1.5, NaN, 2 ** 32, Infinity].map(x => say(() => make(x))).join(" "), say(() => make(2 ** 31)), say(() => make([7])), say(() => make({ valueOf: () => 2 })).slice(0, 6));
const fill = (n, v) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = v; return a; }; console.log(fill(3, 1).join(), fill(2, 0.5).join(), fill(2, "s").join(), fill(0, 1).length, fill(2.0, undefined).length);
class L extends Array {} console.log(new L(2).length, new L("2").length, Reflect.construct(Array, [2], L) instanceof L, Array.length, new Array().length, new Array(1, 2).length);
const twice = k => { const a = new Array(k), b = new Array(k); for (let i = 0; i < a.length; i++) { a[i] = i; b[a.length - 1 - i] = a[i]; } return a.join() + "|" + b.join(); }; console.log(twice(3), twice("x"), twice(1));
