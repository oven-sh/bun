// Variables that hold views: accesses at constant distances, at the edges and outside, while the views are detached, resized, replaced, cleared, and given a buffer of their own.
var memory, bytes, shorts, words, floats, own, log = [], calls = [];
function unsigned(value) { if (value >= 0) return value; return value + 4294967296; }
function start(size, resizable) { memory = resizable ? new ArrayBuffer(size, { maxByteLength: size * 2 }) : new ArrayBuffer(size); bytes = new Uint8Array(memory); shorts = new Uint16Array(memory); words = new Int32Array(memory); floats = new Float64Array(memory); own = new Int32Array(6); for (var i = 0; i < size >> 2; i++) words[i] = (i * 40503) & 0xffff; for (var i = 0; i < 6; i++) own[i] = i * 7 - 9; }
function show(list) { return list.map(function (x) { return Object.is(x, -0) ? "-0" : String(x); }).join(); }
function rotate(p) { var a, b, c, d; a = shorts[(p + -2) >> 1]; b = shorts[p >> 1]; c = shorts[(p + -4) >> 1]; d = shorts[(p + -6) >> 1]; shorts[(p + -2) >> 1] = d; shorts[p >> 1] = c; shorts[(p + -6) >> 1] = a; shorts[(p + -4) >> 1] = b; return [a, b, c, d, shorts[(p + -10) >> 1]]; }
function frame(sp) { var fp = sp >> 2, a = words[fp], b = words[fp + 1], c = a >> 2; if (!(b == 0)) { b = words[c]; c = (c + b + a) | 0; words[fp + 2] = c; floats[fp + 3] = c; } b = bytes[sp + 1]; bytes[sp + 17] = b; if (unsigned(b) >= unsigned(c)) log.push(sp); return [a, b, c, words[fp + 2], floats[fp + 3]]; }
function replaced(p, next) { var a = own[p], b = own[p + 1]; own[p + 2] = (own = next, 5); return [a, b, own[p], own[p + 1], own[p + 2]]; }
function fractions(p) { var a = own[p], b = own[p + 1]; own[p + 1] = 2.5; own[p] = "7"; own[p + 2] = undefined; return [a, b, own[p], own[p + 1], own[p + 2], own["1"], own[1.5], own[-0]]; }
function sorted(sp, rounds) {
  var fp = sp >> 2, low = words[fp], at = words[fp + 1], flag = words[fp + 2], left, right, turns = 0, kept = words[fp + 3];
  while (true) {
    left = bytes[at + -6]; right = shorts[(at + -4) >> 1]; left = left & 1;
    if (left == 0) { left = right & 31; left = left << 3; kept = (low + left) | 0; left = shorts[(kept + 8) >> 1]; left = (left + 1) | 0; shorts[(kept + 8) >> 1] = left; }
    else { if (!(flag == 0)) { left = (right & 31) << 3; left = (low + left) | 0; right = shorts[low >> 1]; left = shorts[(left + 8) >> 1]; if (!(unsigned(right) < unsigned(left))) calls[right & 3](sp); } kept = (low + left) | 0; right = shorts[(kept + 10) >> 1]; right = (right + 1) | 0; shorts[(kept + 10) >> 1] = right; }
    kept = shorts[(at + -4) >> 1]; left = shorts[at >> 1]; right = shorts[(at + -2) >> 1]; shorts[at >> 1] = kept; shorts[(at + -4) >> 1] = left; shorts[(at + -2) >> 1] = right;
    left = shorts[(at + -10) >> 1]; if (unsigned(kept) >= unsigned(left)) log.push(turns); if (++turns > rounds) break; kept = words[fp + 3]; at = (at + -4) | 0;
  }
  return [at, kept, left, right, turns];
}
function attempt(name, f) { try { console.log(name, show([].concat(f()))); } catch (e) { console.log(name, e.name); } }
calls.push(function (sp) { log.push("a"); }, function (sp) { words[(sp >> 2) + 3] = sp; }, function (sp) { log.push(words.length); }, function (sp) { if (log.length == 40) memory.transfer(); log.push("d"); });
attempt("nothing yet", function () { return rotate(8); });
attempt("nothing stored", function () { words[0] = 1; });
for (var size of [4096, 64]) for (var resizable of [false, true]) {
  start(size, resizable);
  for (var p of [8, 10, 4, 2, 0, -2, size, size - 2, size + 8, 1 << 20, -2147483648, 2147483646, 2147483647]) { attempt("rotate " + p, function () { return rotate(p); }); attempt("frame " + p, function () { return frame(p); }); }
  for (var p of [1.5, NaN, undefined, "2", null, 4294967296, 2147483648, -0, {}]) { attempt("odd " + String(p), function () { return rotate(p); }); attempt("odd " + String(p), function () { return frame(p); }); }
  for (var p of [0, 1, 2, 3, 4, 5, 6, -1, -2, 2147483647]) attempt("fractions " + p, function () { return fractions(p); });
  attempt("replaced", function () { return replaced(1, new Int32Array([9, 8, 7, 6])); });
  attempt("replaced by a shorter", function () { return replaced(1, new Int32Array(2)); });
  attempt("replaced by one that grows", function () { return replaced(0, new Int32Array(new ArrayBuffer(8, { maxByteLength: 32 }))); });
  attempt("grown", function () { own.buffer.resize(32); return replaced(3, own); });
  attempt("shrunk", function () { own.buffer.resize(8); return replaced(0, own); });
  attempt("replaced by a shared one", function () { return replaced(1, new Int32Array(new SharedArrayBuffer(16))); });
  attempt("a buffer of its own", function () { own = new Int32Array([1, 2, 3, 4]); var first = own[0] + own[1], buffer = own.buffer; own[2] = 12; new Int32Array(buffer)[3] = 13; return [first, own[2], own[3], fractions(1), own]; });
  attempt("part of it", function () { own = own.subarray(1, 3); return [fractions(0), fractions(1), own.length]; });
  attempt("cleared", function () { own = null; return fractions(0); });
  attempt("undefined", function () { own = undefined; return fractions(0); });
  attempt("again", function () { own = new Int32Array(3); return fractions(0); });
  for (var rounds of [5, 60]) for (var at of [60, 464, 2000, size, 12]) { words[4] = 32; words[5] = at; words[6] = at & 8; words[7] = 5; attempt("sorted " + at, function () { return sorted(16, rounds); }); }
  if (resizable) { attempt("resized", function () { memory.resize(48); return [rotate(8), frame(8), rotate(60)]; }); attempt("grown again", function () { memory.resize(size * 2); return [rotate(8), frame(8), rotate(60), frame(size + 8)]; }); }
  attempt("sent", function () { var sent = structuredClone(memory, { transfer: [memory] }); return [sent.byteLength, rotate(8), frame(8), words.length]; });
  attempt("sorted without", function () { return sorted(16, 3); });
}
console.log(log.length, log.slice(0, 60).join());
