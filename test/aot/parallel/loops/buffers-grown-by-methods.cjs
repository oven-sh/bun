// A loop writes into a view that a method may replace: `.length` and an index make no array of what the method returns, the field's stores say that it is a view.
// STATISTIC: VectorsOfViewsRead >= 7
(function () {
"use strict";
var box = {}, SLOT = JSON.parse('"slot"'), KEY = JSON.parse('"buffer"');
function unknown(s) { box[SLOT] = s; return box[SLOT]; }
function Stream(bytes) { this.bytes = bytes; this.bufferLength = 0; this.position = 0; this.buffer = new Uint8Array(0); this.grown = 0; }
Stream.prototype = Object.create({ kind: "stream" });
Stream.prototype.ensureBuffer = function (requested) {
  var buffer = this.buffer, current = buffer ? buffer.byteLength : 0;
  if (requested < current) return buffer;
  var size = 64; while (size < requested) size <<= 1;
  var larger = new Uint8Array(size);
  for (var i = 0; i < current; i++) larger[i] = buffer[i];
  this.grown++;
  return this.buffer = larger;
};
Stream.prototype.getCode = function () { var bytes = this.bytes; return this.position < bytes.length ? bytes[this.position++] : 256; };
Stream.prototype.readBlock = function () {
  var buffer = this.buffer, limit = buffer ? buffer.length : 0, pos = this.bufferLength;
  while (true) {
    var code = this.getCode();
    if (code < 200) { if (pos + 1 >= limit) { buffer = this.ensureBuffer(pos + 1); limit = buffer.length; } buffer[pos++] = code; continue; }
    if (code === 256) { this.bufferLength = pos; return pos; }
    var len = (code & 15) + 1, dist = 1 + (code >> 3 & 7);
    if (pos + len >= limit) { buffer = this.ensureBuffer(pos + len); limit = buffer.length; }
    for (var k = 0; k < len; ++k, ++pos) buffer[pos] = buffer[pos - dist];
  }
};
Stream.prototype.sum = function () { var sum = 0, buffer = this.buffer; for (var i = 0; i < this.bufferLength; i++) sum = sum * 31 + buffer[i] | 0; return sum; };
function bytesOf(seed, n) { var bytes = []; for (var i = 0; i < n; i++) { seed = seed * 1103515245 + 12345 & 0x7fffffff; bytes.push(seed >> 8 & 255); } return bytes; }
var total = 0; for (var t = 0; t < 200; t++) { var stream = new Stream(bytesOf(t, 60 + t)); total = total * 17 + stream.readBlock() + stream.sum() + stream.grown | 0; }
console.log(total);
var kinds = [null, [], [1, 2, 3], new Uint8Array(100), new Uint8ClampedArray(90), new Float64Array(80), new Int8Array(70), new Uint8Array(new ArrayBuffer(64, { maxByteLength: 128 })), new (class Bytes extends Uint8Array {})(99), { length: 50 }, Buffer.alloc(66), undefined];
kinds.forEach(function (kind, i) {
  var stream = new Stream(bytesOf(i + 5, 30)), said; unknown(stream)[KEY] = kind;
  try { said = stream.readBlock() + " " + stream.sum(); } catch (e) { said = e.constructor.name; }
  var held = stream.buffer; console.log(i, said, stream.grown, held === kind, held && held.length, held && typeof held === "object" ? String(held[0]) + String(held[1]) + String(held[12]) : "");
});
[function () { return [9, 9, 9]; }, function (n) { return this.buffer = new Float32Array(n + 8); }, function (n) { var view = new Uint8Array(n + 4); Object.defineProperty(view, "length", { value: 10 }); return this.buffer = view; }, function () { return null; }, function (n) { var view = new Uint8Array(n + 20); this.calls = (this.calls | 0) + 1; if (this.calls > 2) structuredClone(view, { transfer: [view.buffer] }); return this.buffer = view; }, function (n) { throw new RangeError("grow " + n); }].forEach(function (grow, i) {
  var stream = new Stream(bytesOf(i + 50, 40)), said; stream.ensureBuffer = grow;
  try { said = stream.readBlock() + " " + stream.sum(); } catch (e) { said = e.constructor.name + (e instanceof RangeError ? e.message : ""); }
  console.log("grown", i, said, stream.buffer && stream.buffer.length, stream.position);
});
})();
