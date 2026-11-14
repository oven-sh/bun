// A call of a function of the scope that always throws ends its way: what comes behind knows what the other ways left.
// STATISTIC: DirectCallsWithoutReturn >= 4
(function () {
"use strict";
var told = [];
function log(text) { told.push(text); }
function error(message) { log("Error: " + message); throw new Error(message); }
function forever(n) { for (;;) { if (--n < 0) throw new RangeError("done " + n); } }
function both(message) { if (message) throw new TypeError(message); else throw null; }
async function rejects(message) { throw new Error(message); }
function* yields(message) { throw new Error(message); }
function Reader(bytes) { this.bytes = bytes; this.position = 0; this.size = 0; this.bits = 0; }
Reader.prototype.code = function (table, most) {
  var size = this.size, bits = this.bits, bytes = this.bytes, position = this.position, b;
  while (size < most) {
    if (typeof (b = bytes[position++]) === "undefined") error("no byte " + position);
    bits |= b << size;
    size += 8;
  }
  var code = table[bits & (1 << most) - 1], length = code >> 16;
  if (size === 0 || size < length || length === 0) error("bad code");
  this.bits = bits >> length;
  this.size = size - length;
  this.position = position;
  return code & 0xffff;
};
function choose(value) {
  var result;
  if (value > 9) result = value * 2;
  else if (value < 0) result = error("negative " + value);
  else if (value === 5) forever(value);
  else result = value + 1;
  return result | 0;
}
function caught(value) {
  var at = 0;
  try { at = 1; if (value & 1) both(value & 2 ? "odd" : ""); at = 2; } catch (e) { at += e === null ? 10 : 20; } finally { at += 100; }
  return at;
}
function tail(value) { if (value === 3) return both("tail"); return value; }
class Base { constructor(value) { if (value < 0) error("base " + value); this.value = value; } }
class Heir extends Base { constructor(value) { super(value); if (this.value === 7) both("heir"); this.more = value; } }
var table = new Uint32Array(16); for (var i = 0; i < 16; i++) table[i] = (1 + i % 4) << 16 | i * 3;
var sum = 0;
for (var t = 0; t < 200; t++) {
  var reader = new Reader(new Uint8Array(12).fill(t * 37 & 255)); if (t % 9 === 4) table[3] = 0; else table[3] = 4 << 16 | 9;
  try { for (;;) sum += reader.code(table, 4) + reader.size; } catch (e) { sum += e.message.length + reader.position; }
}
console.log(sum, told.length, told[told.length - 1]);
for (var value of [12, -3, 5, 4, -0, 9.5, "7", null, NaN]) { var said; try { said = choose(value); } catch (e) { said = e.constructor.name + " " + e.message; } console.log(String(value), said, caught(value)); }
for (var n = 0; n < 6; n++) { var said2; try { said2 = tail(n); } catch (e) { said2 = e.message; } console.log(n, said2, caught(n)); }
for (var v of [1, -1, 7]) { var made; try { made = new Heir(v); made = made.value + made.more; } catch (e) { made = e.constructor.name + e.message; } console.log(v, made); }
var promise = rejects("later"), steps = yields("step"); console.log(promise instanceof Promise, typeof steps.next); promise.catch(e => console.log("rejected " + e.message)); try { steps.next(); } catch (e) { console.log("stepped " + e.message); }
var again = new Reader([1, 2, 3]); try { console.log(again.code(table, 4), again.code([], 2)); } catch (e) { console.log(e.message); } console.log(told.length, told.slice(-4).join());
})();
