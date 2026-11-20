// A counter that grows by a step is a whole number that may leave the integers: it is kept in a double. A list of numbers read under it gives its numbers unboxed; a key that is no index (NaN, Infinity, 2 ** 32 - 1, a negative, a number past 2 ** 53) is a name and is looked for as one.
function Shelf(many, named) {
  const heights = new Array(many);
  for (let at = 0; at < many; at++) heights[at] = (at % 2 ? -1 : 1) * Math.sqrt(at + 0.5) / 3;
  if (named) { heights.NaN = 0.25; heights.Infinity = 0.5; heights["-4"] = 0.75; heights["4294967295"] = 1.25; heights["-Infinity"] = 1.5; heights["89412376652763660"] = 1.75; }
  this.heights = heights;
}
Shelf.prototype.sum = function (width) { const heights = this.heights, step = 1 << width; let s = 0, k = 0; for (let turns = 10; turns > 0; turns--) { s += heights[k] * 0.5 + heights[k + 1] * heights[2 * k]; k += step; } return s; };
Shelf.prototype.grown = function (width) { const heights = this.heights; let s = 0, missing = 0; for (let i = 0, k = 1 << width; i < 14; i++, k = k * k - k) { const y = heights[k] * 2; if (y === y) s += y; else missing++; } return missing + " " + s.toFixed(6); };
Shelf.prototype.below = function (width) { const heights = this.heights, step = 1 << width; let s = 0, missing = 0; for (let i = 0, k = -8; i < 8; i++, k += step) { const y = heights[k] * 2; if (y === y) s += y; else missing++; } return missing + " " + s.toFixed(6); };
Shelf.prototype.shrunk = function (width) { const heights = this.heights; let s = 0, missing = 0; for (let i = 0, k = -(1 << width); i < 14; i++, k = -(k * k)) { const y = heights[k] * 2; if (y === y) s += y; else missing++; } return missing + " " + s.toFixed(6); };
Shelf.prototype.high = function (width) { const heights = this.heights, step = 1 << width; let s = 0, missing = 0; for (let i = 0, k = 4294967291; i < 8; i++, k += step) { const y = heights[k] * 2; if (y === y) s += y; else missing++; } return missing + " " + s.toFixed(6); };
Shelf.prototype.zero = function (width) { const heights = this.heights; let s = 0; for (let i = 0, k = -(width >> 9); i < 3; i++, k = k * -1) s += heights[k] * 2; return s.toFixed(6); };
const plain = new Shelf(64, 0), named = new Shelf(64, 1), short = new Shelf(2, 1);
for (let turn = 0; turn < 3; turn++) for (let width = 0; width < 5; width++) {
  console.log(width, String(plain.sum(width)).slice(0, 12), plain.grown(width), plain.below(width), plain.shrunk(width), plain.high(width), plain.zero(width));
  console.log(width, String(named.sum(width)).slice(0, 12), named.grown(width), named.below(width), named.shrunk(width), named.high(width), named.zero(width));
  console.log(width, String(short.sum(width)).slice(0, 12), short.grown(width), short.below(width), short.shrunk(width), short.high(width), short.zero(width));
}
