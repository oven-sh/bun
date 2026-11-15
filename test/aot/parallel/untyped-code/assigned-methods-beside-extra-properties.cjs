// Methods that the program assigns to a prototype, called in a loop off instances that hold properties beside their fields.
(function () {
function later(text) { return eval(text); }
function fail(what) { throw new Error("what " + what); }
const CODE = ["co", "de"].join(""), TAKE = ["ta", "ke"].join("");
function Source() { this.buffer = null; this.limit = 0; this.size = 0; }
Source.prototype = { grow: function (n) { if (n < this.limit) return this.buffer; let size = 8; while (size < n) size <<= 1; const b = new Uint8Array(size); for (let i = 0; i < this.limit; ++i) b[i] = this.buffer[i]; this.limit = size; return this.buffer = b; } };
const Stream = (function () {
  function Stream(bits) { this.bits = bits; this.at = 0; this.held = 0; this.left = 0; Source.call(this); }
  Stream.prototype = Object.create(Source.prototype);
  Stream.prototype.take = function (n) { if (n > 8) fail(n); while (this.left < n) { this.held |= this.bits[this.at++ & 63] << this.left; this.left += 8; } const v = this.held & ((1 << n) - 1); this.held >>= n; this.left -= n; return v; };
  Stream.prototype.code = function (table) { if (table[1] > 8) fail(table[1]); const v = this.take(table[1]); return table[0][v]; };
  Stream.prototype.block = function (table, most) {
    let buffer = this.buffer, limit = buffer ? buffer.length : 0, pos = this.size, sum = 0, round = 0;
    while (true) {
      let c = this.code(table);
      if (c < 200) { if (pos + 1 >= limit) { buffer = this.grow(pos + 1); limit = buffer.length; } buffer[pos++] = c; if (++round > most) break; continue; }
      if (c === 255) break;
      c = this.take(3);
      for (let k = 0; k < c; ++k) sum = (sum * 31 + this.code(table)) | 0;
      if (++round > most) break;
    }
    this.size = pos;
    return sum + pos;
  };
  return Stream;
})();
const bits = new Uint8Array(64), table = [new Uint32Array(32), 5];
for (let i = 0; i < 64; ++i) bits[i] = (i * 37 + 11) & 255;
for (let i = 0; i < 32; ++i) table[0][i] = (i * 53 + 7) & 255;
function run(dress) { let hash = 0; for (let i = 0; i < 40; ++i) { const s = new Stream(bits); let said; try { dress(unknown(s), i); said = s.block(table, 30) + s.block(table, 9); } catch (e) { said = e.constructor.name.length; } hash = (Math.imul(hash, 31) + said) | 0; } return hash; }
let hits = 0;
var unknown = later("s => s");
console.log(run(() => {}), run(s => { s.parameters = 1; }), run((s, i) => { s["p" + (i % 5)] = i; }), run(s => { s[3] = 1; s.name = "n"; }));
console.log(run((s, i) => { s.parameters = 1; if (i % 3 === 1) s[CODE] = function () { ++hits; return 5; }; }), hits);
console.log(run((s, i) => { s.other = 1; if (i % 3 === 1) Object.defineProperty(s, CODE, { get() { ++hits; return () => 9; } }); }), hits);
console.log(run((s, i) => { s[CODE] = null; if (i & 1) delete s[CODE]; }), hits);
console.log(run((s, i) => { for (let k = 0; k < 70; ++k) s["k" + k] = k; if (i % 4 === 2) s[TAKE] = n => ++hits & ((1 << n) - 1); }), hits);
console.log(run((s, i) => { s.more = 1; if (i % 4 === 2) Object.setPrototypeOf(s, { __proto__: Stream.prototype, [CODE]() { ++hits; return 11; } }); }), hits);
console.log(run((s, i) => { s.more = 1; s.bits = { get 0() { if (++hits % 7 === 5) s[CODE] = () => 4; return 17; }, 1: 5, 2: 9 }; }), hits);
console.log(run(s => Object.preventExtensions(Object.assign(s, { parameters: {} }))), hits);
const old = Stream.prototype[CODE];
Reflect.set(Stream.prototype, CODE, function (t) { ++hits; return old.call(this, t) ^ 1; });
console.log(run(() => {}), run(s => { s.parameters = 1; }), hits);
})();
