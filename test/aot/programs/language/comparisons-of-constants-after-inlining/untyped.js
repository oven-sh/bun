"use strict";
function strict(a, b) { return a === b; }
function loose(a, b) { return a == b; }
function not(a) { return !a; }
function truthy(a) { return a ? "t" : "f"; }
function nil(a) { return a == null; }
function pick(type) { if (type === "error") return "E"; if (type === "x") return "X"; return "other"; }
function all() {
  const out = [];
  out.push(strict("x", "x"), strict("x", "y"), strict("", ""), strict("x", "x "), strict("é", "é"), strict("é", "é"), strict("a\0b", "a\0b"), strict("a\0b", "a\0c"));
  out.push(strict(1, 1), strict(1, 2), strict(1, 1.0), strict(0, -0), strict(-0, 0), strict(NaN, NaN), strict(0.1 + 0.2, 0.3), strict(1.5, 1.5), strict(9007199254740992, 9007199254740993), strict(1e308 * 10, Infinity));
  out.push(strict(1, "1"), strict(true, 1), strict(null, undefined), strict(null, null), strict(undefined, undefined), strict(undefined, 0), strict(null, false), strict(true, true), strict(true, false), strict("true", true));
  out.push(loose(1, "1"), loose(true, 1), loose(null, undefined), loose(null, null), loose(undefined, 0), loose(null, false), loose(null, ""), loose("", 0), loose("x", "x"), loose("x", "y"), loose(0, -0), loose(NaN, NaN), loose(true, "1"), loose(false, ""), loose(2, true));
  out.push(not(0), not(1), not(-0), not(NaN), not(""), not("0"), not(null), not(undefined), not(true), not(false), not(0.5));
  out.push(truthy(0), truthy(1), truthy(-1), truthy(""), truthy("a"), truthy(null), truthy(undefined), truthy(NaN), truthy(true), truthy(false));
  out.push(nil(null), nil(undefined), nil(0), nil(""), nil(false), nil(NaN), nil("null"));
  out.push(pick("error"), pick("x"), pick("y"), pick(1), pick(null));
  return out;
}
// Inside a handler, and where the compared value is not a constant after all.
function watched() { try { return strict("a", "a") + ":" + loose(null, 0) + ":" + not(1); } catch (e) { return "caught"; } }
function given(a, b) { return [strict(a, "x"), strict("x", a), loose(a, b), not(a), nil(b), pick(a)].join(); }
module.exports = { all, watched, given };
