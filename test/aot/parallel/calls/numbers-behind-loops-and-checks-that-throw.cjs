// Behind a loop and the checks after it, which call what never returns, a function goes on with what its typed loop knows: the numbers are boxed for no operation.
"use strict";
function fail(text) { throw new RangeError(text); }
function check(is, text) { if (!is) fail(text); }
function decoded(text, at) {
  let value = 0, scale = 1, n = 0;
  for (; at < text.length; at++) { const digit = text.charCodeAt(at) - 48; if (digit < 0 || digit > 9) break; value += digit * scale; scale *= 7; n++; }
  if (n === 0) fail("no digits at " + at);
  if (value > 1e9) fail("too large: " + value);
  const half = value >> 1, rest = value - half * 2;
  return half * 3 + rest + at;
}
function mean(list, low) {
  let sum = 0, least = Infinity, i = 0;
  while (i < list.length) { const v = +list[i]; sum += v; if (v < least) least = v; i++; }
  if (least < low) fail("below " + low);
  if (i === 0) { fail("empty"); }
  check(sum === sum, "no number");
  const step = sum / i;
  return (step - least) * 2 + i;
}
function packed(list) { let bits = 0, n = 0; for (const v of list) { bits = (bits << 2) | (v & 3); n += 2; } if (n > 32) fail("wide"); if (n < 2 && n !== 0) fail("odd"); let out = bits >>> 0; out = out / 2 + n; return out; }
function nested(rows) { let total = 0; for (const row of rows) { let width = 0; for (let x = 0; x < row.length; x++) { if (row[x] === "|") width++; total += width; } if (width > 4) fail("row of " + width); total = total * 2 + width; } return total; }
function added(list, n) { let sum = 0; while (n < list.length) { sum += list[n]; n++; } if (sum < 0) fail("below"); if (n > 50) fail("long"); const half = sum * 0.5; return half * half + n; }
function least(o, n) { let low = o.start, at = 0; for (let i = 0; i < n; i++) { const v = o.list[i]; if (v < low) { low = v; at = i; } } if (at > 40) fail("far"); if (low === 0) fail("zero"); return low * 2 + at; }
const said = (f, ...all) => { try { const v = f(...all); return Object.is(v, -0) ? "-0" : String(v); } catch (error) { return error.constructor.name + (error instanceof RangeError ? " " + error.message : ""); } };
for (let k = 0; k < 100; k++) { said(decoded, "12" + (k % 7), 0); said(mean, [k, 2, 3.5], 0); said(packed, [k, 1, 2]); said(nested, ["a|b", "c" + k]); const o = JSON.parse('{"start":9,"list":[4,2.5,8,3]}'); said(least, o, 4); said(added, o.list, k & 1); }
for (const text of ['{"start":9,"list":[4,2,8]}', '{"start":0.5,"list":[]}', '{"start":"7","list":[6,"5",null]}', '{"start":0,"list":[1]}', '{"list":[1,2]}']) { const o = JSON.parse(text); console.log(said(least, o, 3), said(added, o.list, 0), said(added, o.list, 1.5), said(added, o.list, "1")); }
for (const [text, at] of [["123", 0], ["123", 1], ["", 0], ["x", 0], ["9999999999999", 0], ["66x", 0], ["5", 9], [["1", "2"].join(""), 0], ["\u0663", 0]]) console.log(said(decoded, text, at));
for (const [list, low] of [[[1, 2, 3], 0], [[], 0], [[1.5, -2], -3], [[1, -2], 0], [["4", null], 0], [[NaN], 0], [[2 ** 40, 1], 0], [[1, , 3], 0], [new Float32Array([0.5, 2]), 0], [[1n], 0], [[{}], 0]]) console.log(said(mean, list, low));
for (const list of [[], [1], [1, 2, 3], Array(16).fill(3), Array(17).fill(1), ["1", null, 2.7], [2 ** 33 + 1], [Symbol.iterator]]) console.log(said(packed, list)); console.log(said(nested, []), said(nested, ["|||", "||"]), said(nested, ["|||||"]), said(nested, [["|", 1], "||||"]), said(nested, [null]), said(decoded, null, 0));
