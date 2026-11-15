// Built-ins that a wrapped library keeps in variables of its function: called in front of their assignment and behind it, with whatever they are handed.
"production" !== process.env.NO_SUCH_MODE && (function () {
  const order = [];
  const attempt = f => { try { const v = f(); return Object.is(v, -0) ? "-0" : String(v); } catch (e) { return e.constructor.name; } };
  function level(x) { return 31 - clz32(x); }
  function width(a, b) { return clz32(a) + clz32(b) * 100; }
  function rounded(x) { return floor(x) + "|" + ceil(x) + "|" + trunc(x) + "|" + sign(x); }
  function product(a, b) { return imul(a, b) + "|" + max(a, b) + "|" + pow(a, b) + "|" + min(a, b, 3); }
  function changed(x) { return abs(x); }
  function missing(x) { return never(x); }
  function loop(list) { let n = 0; for (let i = 0; i < list.length; i++) n += clz32(list[i]) + floor(list[i]); return n; }
  const functions = { level, width, rounded, product, changed, missing, loop };
  console.log(Object.keys(functions).map(name => name + " " + attempt(() => functions[name](5, 6))).join(", "));
  var clz32 = Math.clz32 ? Math.clz32 : fallback, floor = Math.floor, ceil = Math.ceil, trunc = Math.trunc, sign = Math.sign, imul = Math.imul, max = Math.max, min = Math.min, pow = Math.pow, abs = Math.abs, never;
  function fallback(x) { x >>>= 0; return x === 0 ? 32 : 31 - ((Math.log(x) / Math.LN2) | 0) | 0; }
  const values = [0, -0, 1, 7, 2 ** 31, 2 ** 32 + 5, -1, 0.5, -1.5, NaN, Infinity, "8", "x", "", null, undefined, true, [], [4], [1, 2], {}, 5n, Symbol.iterator, { valueOf() { order.push("v"); return 3; } }, { valueOf() { throw new RangeError("no"); } }, { toString() { order.push("s"); return "12"; } }, new Date(9), () => 1];
  for (const value of values) console.log(attempt(() => level(value)), attempt(() => width(value, 3)), attempt(() => width(1, value)), attempt(() => rounded(value)), attempt(() => product(value, 2)), attempt(() => product(3, value)), attempt(() => changed(value)), attempt(() => missing(value)));
  console.log(order.join(""), attempt(() => level()), attempt(() => floor.call(null, 2.5)), attempt(() => new clz32(1)), loop([1, 2.5, "3"]), attempt(() => loop([1, 5n])));
  if (order.length) abs = x => "mine" + typeof x;
  console.log(changed(-3), changed("y"));
  never = Math.cbrt;
  console.log(missing(27), attempt(() => missing({ valueOf: () => 8 })));
  clz32 = undefined;
  console.log(attempt(() => level(1)), attempt(() => width(order.push("late"), 2)), order[order.length - 1]);
  module.exports = functions;
})();
console.log(typeof module.exports.level);
