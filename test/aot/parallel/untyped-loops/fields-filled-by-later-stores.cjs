"use strict";
// A field that its constructor leaves null or fills with what an unknown call gives holds the typed arrays that other methods, and other classes under the same name, store.
var Stream = (function () {
  function Stream() { this.pos = 0; this.buffer = null; this.eof = false; }
  Stream.prototype = {
    ensure: function (requested) {
      var buffer = this.buffer;
      var current = buffer ? buffer.byteLength : 0;
      if (requested < current) return buffer;
      var size = 8;
      while (size < requested) size <<= 1;
      var larger = new Uint8Array(size);
      for (var i = 0; i < current; ++i) larger[i] = buffer[i];
      return (this.buffer = larger);
    },
    copy: function (count, distance) {
      var buffer = this.ensure(this.pos + count), pos = this.pos;
      for (var k = 0; k < count; ++k, ++pos) buffer[pos] = buffer[pos - distance];
      this.pos = pos;
      return buffer[pos - 1];
    },
  };
  return Stream;
})();
class Bits {
  constructor(source) { this.bytes = source.take(); this.at = 0; this.table = undefined; }
  sum(count) { var bytes = this.bytes, total = 0, b; for (var i = 0; i < count; i++) { if (typeof (b = bytes[i]) == "undefined") return -total; total = (total * 3 + (b << 2)) | 0; } return total; }
  fill(size) { this.table = new Uint32Array(size); for (var i = 0; i < this.table.length; i++) this.table[i] = i * 0x1000001; return this.table; }
  find(value) { var table = this.table, found = 0; for (var i = 0; i < table.length; i++) if (table[i] === value) found++; return found; }
}
function Reader(list) { this.bytes = new Uint8Array(list); }
const unseen = JSON.parse('{"all":[]}');
unseen.all = [Stream, Bits, Reader];
if (process.argv.length > 99) eval(process.argv[99]);
const answers = [];
const say = (...values) => answers.push(values.join(" "));
const tried = run => { try { return run(); } catch (error) { return error.constructor.name; } };
for (let round = 0; round < 3; round++) {
  const stream = new unseen.all[0](), bits = new unseen.all[1]({ take: () => new unseen.all[2]([5, 6, 7, 250]).bytes });
  say(tried(() => stream.copy(3, 1)), tried(() => stream.copy(30, 2)), stream.pos, stream.buffer.length, bits.sum(4), bits.sum(9), tried(() => bits.find(1)), bits.fill(40).length, bits.find(0x1000001 * 3), bits.find(0xffffffff));
  for (const held of [[1, 2, 3.5, , "x"], new Float64Array([1.5, -0, 2 ** 40]), new Int8Array([-1, 200]), "text", null, undefined, { length: 2, 0: 9 }, new Proxy([4, 5], {}), new (class Above extends Uint8Array {})(6), 7]) {
    stream.buffer = held; stream.pos = 1; bits.bytes = held; bits.table = held;
    say(tried(() => stream.copy(2, 1)), tried(() => String(stream.buffer && stream.buffer.length)), tried(() => bits.sum(5)), tried(() => bits.find(2)));
  }
  const gone = new Uint8Array(16); stream.buffer = gone; bits.bytes = gone; structuredClone(gone.buffer, { transfer: [gone.buffer] });
  say(tried(() => stream.copy(2, 1)), bits.sum(3)); delete stream.buffer; delete bits.bytes;
  say(tried(() => stream.copy(2, 1)), tried(() => bits.sum(3)), Object.keys(stream), Object.keys(bits));
}
console.log(answers.join("\n"));
