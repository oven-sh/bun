// The loop computes with a number that nobody knows, and the same number enters as the index of elements.
function expand(a, table) { var b = a.length, c, d = a.slice(0), h = 1; for (a = b; a < 4 * b + 28; a++) { c = d[a - 1]; if (0 === a % b || 8 === b && 4 === a % b) { c = table[c >>> 24] << 24 ^ table[c & 15]; 0 === a % b && (c = c << 8 ^ c >>> 24 ^ h << 24, h = h << 1 ^ 283 * (h >> 7)); } d[a] = d[a - b] ^ c; } return d; }
function sum(list, b) { var s = 0, a; for (a = b; a < 3 * b + 5; a++) s += list[a] + b * .5; return s; }
function store(list, b) { for (var a = b; a < b * 2 + 2; a++) list[a] = list[a - b] + a % b; return list; }
function step(list, b, c) { var s = 0; for (var a = b; a < 60; a += c) { s = s + list[a] * b - list[a - b]; if (s > 1e6) break; } return s; }
function down(list, b) { var s = 0; for (var a = b; a >= 0; a--) s = (s ^ list[a]) + b % 7; return s; }
var writes = 0;
var numbers = [8, 4, 6, 0, 1, 3, -1, -4, 2.5, 7.25, NaN, -0, "4", "x", null, undefined, true, 2147483640, 4294967290, 5n, { valueOf: function () { return ++writes % 9; } }];
var lists = {
  int32s: function () { return [1, 2, 3, 4, 5, 6, 7, 8]; }, doubles: function () { return [1.5, 2, 3, 4, 5, 6, 7, 8]; }, four: function () { return [1, 2, 3, 4]; }, long: function () { return Array.from({ length: 64 }, function (_, i) { return i * 7; }); },
  hole: function () { var x = [1, 2, 3, 4, 5, 6, 7, 8]; delete x[2]; return x; }, values: function () { return ["a", 1, {}]; }, view: function () { return new Int32Array(40).fill(3); }, frozen: function () { return Object.freeze([1, 2, 3, 4, 5, 6]); }, none: function () { return []; },
  text: function () { return "abcdefgh"; }, object: function () { return { length: 8, 0: 1, 7: 2, slice: function () { return this; } }; },
};
var table = Array.from({ length: 256 }, function (_, i) { return i * 7 & 255; });
function show(x) { return typeof x !== "object" || !x ? String(x) : Array.from({ length: 14 }, function (_, i) { var own = Object.getOwnPropertyDescriptor(x, i); return !own ? "-" : typeof own.value === "object" ? "o" : String(own.value); }).join() + x.length; }
for (var name in lists) {
  var hash = 0, last = "";
  numbers.forEach(function (number, place) {
    [function (l) { return place < 2 || typeof number === "object" && number ? expand(l, table) : 0; }, function (l) { return number > 1e6 ? 0 : sum(l, number); }, function (l) { return number > 1e6 ? 0 : store(l, number); }, function (l) { return step(l, number, place % 5 + 1); }, function (l) { return number > 1e6 ? 0 : down(l, number); }].forEach(function (run) {
      var list = lists[name](), result;
      try { result = run(list); } catch (error) { result = error.name; }
      last = show(result) + "|" + show(list) + "|" + writes;
      for (var i = 0; i < last.length; i++) hash = Math.imul(hash, 31) + last.charCodeAt(i) | 0;
    });
  });
  console.log(name, hash, last.slice(0, 80));
}
