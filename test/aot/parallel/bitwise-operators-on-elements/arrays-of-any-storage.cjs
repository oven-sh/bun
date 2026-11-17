// Loops whose elements only bitwise operators take: the arrays hold int32s, doubles, holes or anything else, and may change their storage on the way.
function fold(list, n, x) { for (var i = 0; i < n; i++) x = x << 1 ^ list[i] ^ x >>> 31; return x; }
function digits(list, n) { var low = 0, high = 0; for (var i = 0; i < n; i++) { low = low ^ list[i] & 0x3fff; high = high + (list[i] >> 14) | 0; } return low + "," + high; }
function lookUp(table, keys, n) { var x = -1; for (var i = 0; i < n; i++) x = table[(x ^ keys[i]) & 15] ^ x >>> 8; return ~x; }
function rounds(k, l, m, key, n) { var a = 1, b = 2, c = 3, t; for (var i = 0; i < n; i++) { t = k[a >>> 28] ^ l[b >> 16 & 15] ^ m[c & 15] ^ key[i]; a = b; b = c; c = t; } return a + "," + b + "," + c; }
function multiply(list, target, n, x) { var carry = 0; for (var i = 0; i < n; i++) { var low = list[i] & 0x3fff, high = list[i] >> 14, middle = x * low + high * 3; low = low * x + ((middle & 0x3fff) << 14) + target[i] + carry; carry = (low >> 28) + (middle >> 14); target[i] = low & 0xfffffff; } return carry; }
function converts(list, other, n, x) { for (var i = 0; i < n; i++) { x = x ^ list[i] ^ list[n - 1 - i] << 3; if (i === 4) other[2] = x + .5; x = x + (list[i] & 7) | 0; } return x; }
function past(list, n, x) { for (var i = 0; i < n + 6; i++) x = (x ^ list[i]) >>> 0; return x; }
function negated(list, n, x) { for (var i = n - 1; i >= 0; i--) x = ~list[i] ^ x << (list[i & 3] & 7); return x; }
var writes = 0;
function words(k) { return Array.from({ length: 16 }, function (_, i) { return Math.imul(i * 7 + k, 0x9e3779b9) | 0; }); }
var kinds = {
  int32s: words, small: function (k) { return words(k).map(function (v) { return v & 7; }); }, uint32s: function (k) { return words(k).map(function (v) { return v >>> 0; }); }, fractions: function (k) { return words(k).map(function (v) { return v + .5; }); },
  far: function (k) { return words(k).map(function (v) { return v * 34359738376; }); }, infinite: function (k) { var x = words(k).map(function (v) { return v + .25; }); x[3] = Infinity; x[4] = -0; x[5] = NaN; return x; },
  holes: function (k) { var x = words(k); delete x[3]; delete x[9]; return x; }, holesAmongDoubles: function (k) { var x = words(k).map(function (v) { return v + .5; }); delete x[3]; delete x[9]; return x; }, short: function (k) { return words(k).slice(0, 5); },
  text: function (k) { var x = words(k); x[2] = "5"; return x; }, boxed: function (k) { var x = words(k); x[1] = "q"; x[1] = 4; return x; }, undefined: function (k) { var x = words(k); x[4] = undefined; return x; }, big: function (k) { var x = words(k); x[5] = 3n; return x; },
  frozen: function (k) { return Object.freeze(words(k)); }, getter: function (k) { return Object.defineProperty(words(k), 1, { get: function () { return 3; }, set: function () { writes++; }, configurable: true }); },
  inherits: function (k) { var x = words(k); Object.setPrototypeOf(x, { __proto__: Array.prototype, 3: 77 }); delete x[3]; return x; }, heir: function (k) { class Words extends Array {} return Words.from(words(k)); },
  bytes: function (k) { return Uint8Array.from(words(k)); }, floats: function (k) { return Float64Array.from(words(k)); }, plain: function (k) { return Object.assign({}, words(k)); }, characters: function () { return "0123456789abcdef"; },
  literal: function () { return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; }, literalOfDoubles: function () { return [1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; }, objects: function (k) { var x = words(k); x[6] = { valueOf: function () { return ++writes; } }; return x; }, none: function () { return []; },
};
var names = Object.keys(kinds);
function show(list) { return typeof list !== "object" ? String(list) : Array.from({ length: 23 }, function (_, i) { var own = Object.getOwnPropertyDescriptor(list, i); return !own ? "-" : !("value" in own) ? "g" : typeof own.value === "object" ? "o" : String(own.value); }).join(); }
names.forEach(function (name, place) {
  var hash = 0, last = "";
  var make = function (step) { return kinds[names[(place + step) % names.length]](place + step); };
  [function (p) { return fold(p, 16, place); }, function (p) { return digits(p, 16); }, function (p) { return lookUp(p, make(3), 16); }, function (p) { return lookUp(kinds.int32s(place), p, 12); }, function (p) { return rounds(p, make(1), make(5), make(7), 16); },
    function (p) { return rounds(kinds.int32s(1), kinds.uint32s(2), kinds.holes(3), p, 14); }, function (p) { return multiply(p, make(2), 16, 5); }, function (p) { return multiply(kinds.small(place), p, 16, 5); }, function (p) { return multiply(p, p, 9, 7); },
    function (p) { return converts(p, p, 12, 1); }, function (p) { return converts(p, kinds.int32s(4), 12, 1); }, function (p) { return past(p, 16, 9); }, function (p) { return negated(p, 16, 3); }].forEach(function (run) {
    var list = kinds[name](place), result;
    try { result = run(list); } catch (error) { result = error.name; }
    last = result + "|" + show(list) + "|" + writes;
    for (var i = 0; i < last.length; i++) hash = Math.imul(hash, 31) + last.charCodeAt(i) | 0;
  });
  console.log(name, hash, last);
});
