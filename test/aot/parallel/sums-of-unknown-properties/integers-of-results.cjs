// What takes an integer of a sum or a product of an unknown number, where the function returns it at once: fractions, NaN, -0, wide numbers, strings, nothing.
function value(text) { return JSON.parse(text); }
var words = new Int32Array(8), bytes = new Uint8Array(8), wide = new Float64Array(8), list = [1, 2, 3, 4, 5];
var takers = {
  add: function (xs) { return Atomics.add(words, 0, xs[0] + 0.5); }, sub: function (xs) { return Atomics.sub(words, 1, xs[0] * 1.5); }, or: function (xs) { return Atomics.or(words, 2, xs[0] - 0.25); }, and: function (xs) { return Atomics.and(bytes, 3, xs[0] + xs[1]); }, xor: function (xs) { return Atomics.xor(bytes, 4, -xs[0]); },
  exchange: function (xs) { return Atomics.exchange(words, 5, xs[0] * xs[1]); }, compare: function (xs) { return Atomics.compareExchange(words, 5, xs[0] + 1, xs[1] + 0.5); }, store: function (xs) { return Atomics.store(words, 6, xs[0] + 0.5); }, load: function (xs) { return Atomics.load(words, (xs[0] + 1) & 7); },
  bits: function (xs) { return (xs[0] + xs[1]) | 0; }, shift: function (xs) { return (xs[0] + 0.5) << (xs[1] + 1); }, unsigned: function (xs) { return (xs[0] * 3) >>> 1; }, not: function (xs) { return ~(xs[0] + xs[1]); },
  clz: function (xs) { return Math.clz32(xs[0] + 0.5); }, imul: function (xs) { return Math.imul(xs[0] + 1, xs[1] * 2); }, code: function (xs) { return String.fromCharCode(xs[0] + 65.5).length; }, point: function (xs) { return "abcdef".charCodeAt(xs[0] + 1); }, at: function (xs) { return list.at(xs[0] - 1.5); },
  slice: function (xs) { return list.slice(xs[0] - 1, xs[1] + 2).join(); }, text: function (xs) { return "abcdefgh".slice(xs[0] + 0.5, xs[1] + 3); }, fill: function (xs) { return new Uint8Array(6).fill(xs[0] + 1.5, xs[1] + 0, 5).join(); }, sub8: function (xs) { return bytes.subarray(xs[0] + 1, xs[1] + 4).length; },
  set: function (xs) { return words[7] = xs[0] + 0.5; }, put: function (xs) { words[0] = xs[0] * 1.5; return words[0]; }, index: function (xs) { return list[xs[0] + xs[1]]; }, repeat: function (xs) { return "x".repeat((xs[0] + 1.5) & 7); }, radix: function (xs) { return (255).toString((xs[1] + 2) & 15 | 2); },
};
var inputs = ["[1,2]", "[0.5,1.25]", "[-0.5,3]", "[1099511627776,1]", "[2147483647,2147483647]", "[-2147483648,-1]", "[\"7\",1]", "[\"a\",2]", "[null,1]", "[true,false]", "[[3],2]", "[1e300,1]", "[9007199254740993,2]", "[]", "[1]"];
for (var name in takers) {
  var out = [];
  for (var i = 0; i < inputs.length; i++) { for (var turn = 0; turn < 3; turn++) { try { out.push(String(takers[name](value(inputs[i])))); } catch (e) { out.push(e.name); } } }
  for (var other of [[NaN, 1], [-0, -0], [Infinity, 1], [undefined, 1], [3n, 1], [Symbol.iterator, 1], [{ valueOf: function () { return 2.5; } }, 1], [1, { valueOf: function () { throw new RangeError("v"); } }]]) { try { out.push(String(takers[name](other))); } catch (e) { out.push(e.name); } }
  console.log(name, out.join(" "), words.join(), bytes.join());
}
