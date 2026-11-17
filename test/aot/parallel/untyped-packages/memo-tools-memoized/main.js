// An untyped package and a program of it (memoized): memoize with resolvers, limits and weak keys; once, curry, compose, partial, after, before, pipeline with placeholders
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var calls = []; var fib = lib.memoize(function fib(n) { calls.push(n); return n < 2 ? n : fib2(n - 1) + fib2(n - 2); }); function fib2(n) { return fib(n); } [10, 20, 5, 40, 20].forEach(function (n) { say(n, fib(n), calls.length, fib.hits, fib.misses, fib.name, fib.length); });
var gone = [], m = lib.memoize(function area(a, b) { return this.k * a * (b || 1); }, { max: 4, evict: function (k) { gone.push(k); } }); var o = { k: 2, m: m }; [[1, 2], ['1', 2], [1, '2'], [3], [1, 2], [5, 5], [6], [1, 2], [3], [NaN], [NaN], [-0], [0]].forEach(function (a, i) { say(i, o.m.apply(o, a), m.hits, m.misses, gone.join(','), Array.from(m.cache.keys()).join(' ')); if (i === 6) o.k = 10; });
var keys = [{ a: 1 }, { a: 1 }, [1], null, 'k'], w = lib.memoize(function (x) { return typeof x + calls.length; }, { weak: true }); for (var i = 0; i < 15; i++) { calls.push(i); say(i, w(keys[i * 2 % 5]), w.hits, w.cache.size); }
(async function () { var n = 0, f = lib.memoize(async function (x) { n++; if (n < 3) throw new Error('no ' + n); return x + n; }); for (var i = 0; i < 5; i++) say(i, await f('p').catch(function (e) { return e.message; }), n, f.cache.size); }());
