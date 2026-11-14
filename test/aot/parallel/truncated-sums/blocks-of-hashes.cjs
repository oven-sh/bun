// The words and the table of a hash are held in arrays of int32s, of doubles and of boxed values.
function Hash(table, start) { this.table = table; this.state = start.slice(0); }
Hash.prototype.block = function (words) {
  var i, t, u, f = this.state, g = this.table, a = f[0], b = f[1], c = f[2], d = f[3], e = f[4], h = f[5], j = f[6], k = f[7];
  for (i = 0; 64 > i; i++) {
    if (16 > i) t = words[i];
    else {
      t = words[i + 1 & 15]; u = words[i + 14 & 15];
      t = words[i & 15] = (t >>> 7 ^ t >>> 18 ^ t >>> 3 ^ t << 25 ^ t << 14) + (u >>> 17 ^ u >>> 19 ^ u >>> 10 ^ u << 15 ^ u << 13) + words[i & 15] + words[i + 9 & 15] | 0;
    }
    t = t + k + (e >>> 6 ^ e >>> 11 ^ e >>> 25 ^ e << 26 ^ e << 21 ^ e << 7) + (j ^ e & (h ^ j)) + g[i];
    k = j; j = h; h = e; e = d + t | 0; d = c; c = b; b = a;
    a = t + (b & c ^ d & (b ^ c)) + (b >>> 2 ^ b >>> 13 ^ b >>> 22 ^ b << 30 ^ b << 19 ^ b << 10) | 0;
  }
  f[0] = f[0] + a | 0; f[1] = f[1] + b | 0; f[2] = f[2] + c | 0; f[3] = f[3] + d | 0; f[4] = f[4] + e | 0; f[5] = f[5] + h | 0; f[6] = f[6] + j | 0; f[7] = f[7] + k | 0;
};
function primes() { var found = [], c = 2; for (; found.length < 64; c++) { var isPrime = true; for (var d = 2; d * d <= c; d++) if (c % d === 0) { isPrime = false; break; } if (isPrime) found.push(c); } return found; }
function fraction(x) { return (x - Math.floor(x)) * 4294967296; }
var signed = primes().map(function (p) { return fraction(Math.pow(p, 1 / 3)) | 0; });
var unsigned = signed.map(function (x) { return x >>> 0; });
var boxed = signed.slice(0); boxed[3] = "x"; boxed[3] = signed[3];
var start = primes().slice(0, 8).map(function (p) { return fraction(Math.sqrt(p)) | 0; });
var wide = start.map(function (x) { return x >>> 0; });
function digest(text, table, from, holdWords) {
  var bytes = [], i;
  for (i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 255);
  var length = bytes.length; bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : length * 8 >>> 8 * i & 255);
  var hash = new Hash(table, from);
  for (i = 0; i < bytes.length; i += 64) {
    var words = [];
    for (var j = 0; j < 16; j++) words.push(bytes[i + 4 * j] << 24 | bytes[i + 4 * j + 1] << 16 | bytes[i + 4 * j + 2] << 8 | bytes[i + 4 * j + 3]);
    hash.block(holdWords(words));
  }
  return hash.state.map(function (x) { return ((x | 0) + 17592186044416 * 15).toString(16).slice(-8); }).join("");
}
var holders = {
  int32s: function (w) { return w; },
  doubles: function (w) { return w.map(function (x) { return x >>> 0; }); },
  partial: function (w) { return [w[0] + 1099511627776].concat(w.slice(1)); },
  boxed: function (w) { w[5] = { valueOf: function () { return 0; } }; w[5] = 0; return w; },
  views: function (w) { return Uint32Array.from(w); },
  texts: function (w) { w[2] = String(w[2]); return w; },
  fractions: function (w) { return w.map(function (x) { return x + .25; }); },
  far: function (w) { return w.map(function (x) { return x * 1048576 * 8; }); },
  holes: function (w) { delete w[7]; return w; },
  short: function (w) { return w.slice(0, 12); },
};
var texts = ["", "abc", "The quick brown fox jumps over the lazy dog", "a".repeat(200)];
for (var name in holders)
  for (var text of texts)
    console.log(name, text.length, digest(text, signed, start, holders[name]), digest(text, unsigned, wide, holders[name]), digest(text, boxed, start, holders[name]));
var self = signed.slice(0, 16); new Hash(self, start).block(self); console.log(self.join());
var hash = new Hash(signed, start), data = hash.state.concat(hash.state); for (var n = 0; n < 2000; n++) { hash.block(data.slice(0)); data = hash.state.concat(hash.state); } console.log(hash.state.join());
