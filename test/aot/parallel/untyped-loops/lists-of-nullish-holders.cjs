// Loops copy elements into lists that are read off objects that may be null by their type: bn.js' split and iushrn. Unseen code hands over objects of other kinds.
"use strict";
function Big(words, length) { this.negative = 0; this.words = null; this.length = 0; this.red = null; if (words) { this.words = words; this.length = length; } }
Big.prototype.shift = function shift(s, extended) { if (extended) { for (var i = 0; i < s; i++) extended.words[i] = this.words[i]; extended.length = s; } return this; };
function split(input, output) {
  var outLen = Math.min(input.length, 9);
  for (var i = 0; i < outLen; i++) output.words[i] = input.words[i];
  return outLen;
}
function add(input, output, n) {
  var carry = 0;
  for (var i = 0; i < n; i++) { carry += input.words[i] | 0; output.words[i] = carry & 0x3ffffff; carry >>>= 26; }
  return carry;
}
function replace(input, output, stop) {
  for (var i = 0; i < 9; i++) { output.words[i] = input.words[i]; if (i === stop) output.words = [7, 8, 9]; }
  return i;
}
const call = new Function("f", "values", "return f.apply(undefined, values)");
const show = v => v === null || v === undefined ? String(v) : Array.isArray(v) ? "[" + v.length + " " + Array.from(v, x => Object.is(x, -0) ? "-0" : typeof x === "object" && x ? "obj" : String(x)).join() + "]" : ArrayBuffer.isView(v) ? "view " + v.join() : typeof v === "object" ? "obj" : String(v);
const lists = {
  ints: () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  doubles: () => [1.5, 2, 3, -0, 5, NaN, 7, 8, 9, 10, 11, 12],
  any: () => [1, "a", 3, {}, 5, undefined, 7, 8, 9, 10],
  holes: () => [1, , 3, , 5, 6, 7, 8, 9],
  made: () => new Array(16),
  short: () => [1, 2],
  frozen: () => Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
};
const others = { ...lists, bytes: () => new Uint8Array(12), text: () => "abcdefghijkl", nil: () => null };
const names = ["words", "length"];
const fill = (o, w) => { names.forEach((name, k) => { o[name] = k ? 9 : w; }); return o; };
class Other { constructor(w) { fill(this, w); } }
const holders = {
  other: w => new Other(w),
  plain: w => fill({}, w),
  swapped: w => fill({ red: null }, w),
  accessor: w => Object.defineProperty(fill({}, null), names[0], { get() { return w; }, set(v) { w = v; } }),
  inherited: w => Object.create(fill({}, w)),
  proxy: w => new Proxy(fill({}, w), {}),
  absent: () => ({ length: 9 }),
  nothing: () => undefined,
  nil: () => null,
  text: () => "text",
  number: () => 5,
};
const attempt = f => { try { return show(f()); } catch (e) { return e.name; } };
for (let turn = 0; turn < 3; turn++) for (const a in lists) for (const b in lists) for (const alias of [0, 1, 2]) {
  const input = new Big(lists[a](), 9), output = turn && b === "short" ? alias ? null : undefined : alias === 1 ? input : new Big(alias ? input.words : lists[b](), 9);
  const o = attempt(() => split(input, output)), p = attempt(() => input.shift(5, output)), q = attempt(() => add(input, output, 9)), r = attempt(() => replace(input, output, turn ? 99 : 4));
  console.log(turn, a, b, alias, o, p, q, r, show(input.words), output ? show(output.words) : show(output));
}
console.log(attempt(() => split(null, null)), attempt(() => split(new Big(null, 0), null)), attempt(() => split(new Big([], 0), null)), attempt(() => add(null, undefined, 0)));
for (const h in holders) for (const g in holders) for (const a in others) {
  const input = holders[h](others[a]()), output = holders[g](others[a]());
  const o = attempt(() => call(split, [input, output])), p = attempt(() => call(add, [input, output, 9]));
  console.log(h, g, a, o, p, attempt(() => input.words), attempt(() => output.words));
}
