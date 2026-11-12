// The text of a list whose elements are fractions, booleans, nothing at all and other lists.
var calls = 0, keys = { one: 1, two: 2 }, changed = [3, "c"], held = ["h", 0.5], rope = "r".repeat(3) + calls;
var lists = {
  fractions: function (i) { return ["name" + i, i + 0.25, true, null, undefined, -0, 1e21, NaN]; },
  keys: function (i) { return ["x", i, Object.keys(keys)]; },
  rows: function (i) { return [[1, i], [3, 4], [], ["a", "b"]]; },
  deeper: function (i) { return [i, [1, [2, [3]]], "d"]; },
  wide: function (i) { return ["Ā" + i, [i, "ā"], 2.5]; },
  ropes: function (i) { return [rope + i, [rope, rope + i], held]; },
  holes: function (i) { return [i, [1, , 2], "h"]; },
  shared: function (i) { return [held, held, changed, changed]; },
  objects: function (i) { return [0.5, { toString: function () { calls++; return "o" + i; } }, [{ toString: function () { calls++; return "p"; } }]]; },
  itself: function (i) { var a = [1, "i"]; a.push(a, [a]); return a; },
  many: function (i) { var a = []; for (var k = 0; k < 40; k++) a.push(k % 3 ? k / 4 : [k, "m"]); return a; },
  views: function (i) { return [new Uint8Array([1, 2]), [new Float64Array([0.5])], 1.5]; },
  symbols: function (i) { return [1.5, [Symbol("s")]]; },
  one: function (i) { return [[i]]; },
  empty: function (i) { return [[], []]; },
};
var ways = [function (a) { return a.join(); }, function (a) { return a.join(""); }, function (a) { return a.join("; "); }, function (a) { return a.join(" "); }, function (a) { return String(a); }, function (a) { return "" + a; }, function (a) { return `${[a, 1.5]}`; }];
function texts(make, i) { return ways.map(function (way) { try { return way(make(i)); } catch (e) { return e.constructor.name; } }); }
for (var round = 0; round < 4; round++) {
  for (var name in lists) { var t; for (var i = 0; i < 12; i++) t = texts(lists[name], i); console.log(round, name, calls, JSON.stringify(t)); }
  if (round === 0) changed.toString = function () { calls++; return "T"; };
  if (round === 1) { held.push([7]); delete changed.toString; changed.join = function () { calls++; return "J"; }; }
  if (round === 2) { delete changed.join; Object.setPrototypeOf(changed, { __proto__: Array.prototype, toString: function () { calls++; return "P"; } }); }
}
