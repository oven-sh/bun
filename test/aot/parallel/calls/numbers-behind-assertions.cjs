// Behind a loop and the assertions after it, a function goes on with what its typed loop knows: the numbers are boxed for no operation.
// STATISTIC: AssertionsLookedPast >= 1
(function () {
"use strict";
var told = 0;
function log(text) { told += text.length; }
function error(message) { log(message); throw new Error(message); }
function Stream(bytes) { this.bytes = bytes; this.bytesPos = 0; this.codeSize = 0; this.codeBuf = 0; }
Stream.prototype.getCode = function (table) {
  var codes = table[0], maxLen = table[1], codeSize = this.codeSize, codeBuf = this.codeBuf, bytes = this.bytes, bytesPos = this.bytesPos;
  while (codeSize < maxLen) {
    var b;
    if (typeof (b = bytes[bytesPos++]) == "undefined") error("no byte");
    codeBuf |= b << codeSize;
    codeSize += 8;
  }
  var code = codes[codeBuf & ((1 << maxLen) - 1)], codeLen = code >> 16, codeVal = code & 0xffff;
  if (codeSize == 0 || codeSize < codeLen || codeLen == 0) error("bad code");
  this.codeBuf = codeBuf >> codeLen;
  this.codeSize = codeSize - codeLen;
  this.bytesPos = bytesPos;
  return codeVal;
};
Stream.prototype.getBits = function (bits) {
  var codeSize = this.codeSize, codeBuf = this.codeBuf, bytes = this.bytes, bytesPos = this.bytesPos, b;
  while (codeSize < bits) {
    if (typeof (b = bytes[bytesPos++]) == "undefined") error("no bits");
    codeBuf |= b << codeSize;
    codeSize += 8;
  }
  b = codeBuf & ((1 << bits) - 1);
  this.codeBuf = codeBuf >> bits;
  this.codeSize = codeSize -= bits;
  this.bytesPos = bytesPos;
  return b;
};
Stream.prototype.sum = function (table, most) { var sum = 0; for (var n = 0; n < most; n++) { var code = this.getCode(table); sum += code > 20 ? this.getBits(code & 7) : code; } return sum; };
var box = {}, SLOT = JSON.parse('"slot"'), KEYS = JSON.parse('["codeSize","codeBuf","bytes","bytesPos"]');
function unknown(s) { box[SLOT] = s; return box[SLOT]; }
function tableOf(n, zero) { var codes = new Uint32Array(1 << n); for (var i = 0; i < codes.length; i++) codes[i] = i === zero ? 0 : (1 + i % n) << 16 | i * 7 & 63; return [codes, n]; }
var tables = [tableOf(5, -1), tableOf(9, -1), tableOf(4, 11), [Array.from(tableOf(6, -1)[0]), 6]], total = 0;
for (var t = 0; t < 400; t++) {
  var stream = new Stream(unknown(t % 5 === 4 ? [t & 255, 7, 99, 255, 3, 128, 64] : new Uint8Array(30).fill(t * 91 & 255)));
  try { total += stream.sum(tables[t & 3], 30); } catch (e) { total += e.message.length + stream.bytesPos; }
}
console.log(total, told);
var starts = [["codeSize", -8], ["codeSize", 2147483640], ["codeSize", 2147483647], ["codeSize", 0.5], ["codeSize", "3"], ["codeSize", undefined], ["codeSize", -0], ["codeBuf", 4294967295], ["codeBuf", 1.5], ["codeBuf", -1], ["bytesPos", -1], ["bytesPos", 2147483646], ["bytesPos", "1"], ["bytesPos", 0.5], ["bytes", [300, -1, 2.5, "7", null, undefined, 9]], ["bytes", { 0: 1, 1: 2 }], ["bytes", "0123"], ["codeSize", 5n]];
starts.forEach(function (start) {
  var stream = new Stream(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), said; unknown(stream)[start[0]] = start[1];
  for (var which = 0; which < 4; which++) { try { said = stream.getCode(tables[which]); } catch (e) { said = e.constructor.name + " " + (e.message.length < 9 ? e.message : ""); } console.log(start[0], String(start[1]).slice(0, 12), which, said, String(stream.codeSize), String(stream.codeBuf), String(stream.bytesPos), Object.is(stream.codeSize, -0)); }
});
[function (s) { delete s[KEYS[1]]; }, function (s) { Object.defineProperty(s, KEYS[0], { get() { return 8; }, set(v) { throw new RangeError("set " + v); } }); }, function (s) { Object.setPrototypeOf(s, { getCode: Stream.prototype.getCode, set codeBuf(v) { throw new TypeError("above"); } }); }, function (s) { s.getCode = function () { return 3; }; }].forEach(function (change) {
  var stream = new Stream(new Uint8Array([9, 8, 7])); change(unknown(stream)); var said; try { said = stream.getCode(tables[0]) + " " + stream.sum(tables[1], 2); } catch (e) { said = e.constructor.name; }
  console.log(said, stream.codeSize === 8 ? "eight" : String(stream.codeSize), String(stream.codeBuf), stream.bytesPos);
});
[[null, 3], [tables[0][0]], [tables[0][0], "5"], [tables[0][0], 5.5], [tables[0][0], -1], [tables[0][0], 33], { 0: tables[0][0], 1: 5 }, "ab"].forEach(function (table) { var stream = new Stream(new Uint8Array(9).fill(77)), said; try { said = stream.getCode(table); } catch (e) { said = e.constructor.name; } console.log(said, stream.codeSize, stream.codeBuf, stream.bytesPos); });
})();
