// Straight code reads and stores elements of one array under written indexes: the array holds int32s, or anything else.
function mix(holder, x, y) {
  var f = holder.state, a = f[0], b = f[1], c = f[2], d = f[3];
  f[0] = f[0] + a | 0; f[1] = f[1] + (b ^ c) + x | 0; f[2] = f[2] + (c >>> 3 ^ d) | 0; f[3] = f[3] + y | 0;
  return [a, b, c, d].join();
}
function swap(holder) { var f = holder.state, a = f[0]; f[0] = f[3]; f[3] = f[1]; f[1] = f[2]; f[2] = a ^ f[0]; return f[2] + f[0]; }
function wide(holder, x) { var f = holder.state, sum = (f[0] >>> 0) + (f[1] >>> 0) + f[2] + f[3] + x; f[5] = sum | 0; f[4] = f[5] + f[5] | 0; f[0] = f[4] >>> 1 ^ sum; return sum; }
function late(holder, x) { var f = holder.state, a = f[1], b = f[7]; f[1] = a + b | 0; f[7] = b - a | 0; f[2] = f[1] ^ f[7]; f[3] = f[2] + x | 0; return a - b; }
var writes = 0;
function words(k) { return Array.from({ length: 8 }, function (_, i) { return Math.imul(i * 7 + k, 0x9e3779b9) | 0; }); }
var kinds = {
  int32s: words, small: function (k) { return words(k).map(function (v) { return v & 7; }); }, uint32s: function (k) { return words(k).map(function (v) { return v >>> 0; }); },
  fractions: function (k) { return words(k).map(function (v) { return v + .5; }); }, short: function (k) { return words(k).slice(0, 4); }, none: function () { return []; },
  hole: function (k) { var x = words(k); delete x[3]; return x; }, boxed: function (k) { var x = words(k); x[1] = "q"; x[1] = 4; return x; },
  text: function (k) { var x = words(k); x[2] = "5"; return x; }, undefined: function (k) { var x = words(k); x[1] = undefined; return x; }, big: function (k) { var x = words(k); x[0] = 3n; return x; },
  frozen: function (k) { return Object.freeze(words(k)); }, sealed: function (k) { return Object.seal(words(k)); },
  getter: function (k) { return Object.defineProperty(words(k), 1, { get: function () { return 3; }, set: function () { writes++; }, configurable: true }); },
  readOnly: function (k) { return Object.defineProperty(words(k), 2, { value: 9, writable: false }); },
  object: function (k) { var x = words(k); x[3] = { valueOf: function () { x[0] = 100; return writes++; } }; return x; },
  heir: function (k) { class Words extends Array {} return Words.from(words(k)); }, inherits: function (k) { var x = words(k); Object.setPrototypeOf(x, { __proto__: Array.prototype, 3: 77 }); delete x[3]; return x; },
  bytes: function (k) { return Uint8Array.from(words(k)); }, view: function (k) { return Int32Array.from(words(k)); }, plain: function (k) { return Object.assign({}, words(k)); },
  proxy: function (k) { return new Proxy(words(k), {}); }, characters: function () { return "abcdefgh"; }, nothing: function () { return undefined; }, number: function () { return 12; },
};
var extras = [[1, 2], [4294967295, -5], [.5, 1e300], ["7", NaN], [undefined, null], [{ valueOf: function () { return writes++; } }, true], [5n, 1]];
function show(list) {
  if (typeof list !== "object") return String(list);
  return Array.from({ length: 8 }, function (_, i) { var own = Object.getOwnPropertyDescriptor(list, i); return !own ? "-" : "value" in own ? typeof own.value === "object" ? "o" : String(own.value) : "g"; }).join();
}
var functions = [mix, swap, wide, late];
for (var name in kinds) {
  var lines = "", hash = 0;
  for (var i = 0; i < functions.length; i++) {
    for (var j = 0; j < extras.length; j++) {
      var list = kinds[name](i + j), result;
      try { result = functions[i]({ state: list }, extras[j][0], extras[j][1]); } catch (error) { result = error.name; }
      lines = result + "|" + show(list) + "|" + writes;
      for (var k = 0; k < lines.length; k++) hash = Math.imul(hash, 31) + lines.charCodeAt(k) | 0;
    }
  }
  console.log(name, hash, lines);
}
