// An untyped package and a program of it (protocols): iterators without generators: next, return, chained and lazy
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var R = lib.Range, it = new R(0, 5)[Symbol.iterator](); say(JSON.stringify(it.next()), JSON.stringify(it.return(9)), JSON.stringify(it.next()), it[Symbol.iterator]() === it);
var [a, b, ...c] = new R(0, 7); say(a, b, c.join()); var [p = 'd', q] = new R(0, 1); say(p, q, R.closed); var m = new Map(lib.Lazy.of(new R(0, 5)).map(function (x) { return [x, x * x]; })); say([...m].join(' ')); function f() { return arguments.length; } say(f(...new R(0, 4), ...'ab'), new Set(lib.Lazy.of('mississippi')).size);
function zip() { var its = Array.prototype.map.call(arguments, function (x) { return x[Symbol.iterator](); }); return { [Symbol.iterator]: function () { return this; }, next: function () { var r = its.map(function (i) { return i.next(); }); return r.some(function (x) { return x.done; }) ? { done: true, value: undefined } : { done: false, value: r.map(function (x) { return x.value; }) }; } }; }
for (var i = 0; i < 6; i++) for (var z of zip(new R(0, i), 'abcdef', [1.5, 2.5, 3.5, 4.5])) say(i, z.join()); try { for (var y of lib.Lazy.of(new R(0, 9)).map(function (n) { if (n === 3) throw new Error('at ' + n); return n; })) say(y); } catch (e) { say(e.message, R.closed); }
