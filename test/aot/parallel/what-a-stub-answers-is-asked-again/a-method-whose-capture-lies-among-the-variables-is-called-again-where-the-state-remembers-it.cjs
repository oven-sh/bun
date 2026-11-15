// Flags: --aot-testing=CheckWalkAtRunTime
// The method is a closure with a capture, made once by a function that sets it up; the capture is laid among the variables, so the closure table holds the method without it. Where the walk remembers what the name found, the check asks the object again: for the function by its number, and makes no closure of its own.
"use strict";
function Reader(buffer) { this.buf = buffer; this.pos = 0; this.len = buffer.length; }
Reader.create = function create(buffer) { return new Reader(buffer); };
Reader.prototype.number = (function setUp() { var value = 4294967295; return function number() { value = (this.buf[this.pos] & 127) >>> 0; if (this.buf[this.pos++] < 128) return value; value = (value | (this.buf[this.pos] & 127) << 7) >>> 0; if (this.buf[this.pos++] < 128) return value; if ((this.pos += 5) > this.len) { this.pos = this.len; throw RangeError("past the end"); } return value; }; })();
Reader.prototype.signed = function signed() { var value = this.number(); return value >>> 1 ^ -(value & 1) | 0; };
Reader.prototype.skip = function skip(kind) { switch (kind) { case 0: this.number(); break; case 2: this.pos += this.number(); break; default: throw Error("no such kind " + kind); } return this; };
var Person = (function () {
  function Person() { this.scores = []; this.total = 0; }
  Person.decode = function decode(r, l) {
    if (!(r instanceof Reader)) r = Reader.create(r); var c = l === undefined ? r.len : r.pos + l, m = new Person(), value;
    while (r.pos < c) { var t = r.number(); switch (t >>> 3) {
      case 5: if ((t & 7) === 2) { var c2 = r.number() + r.pos; while (r.pos < c2) m.scores.push(r.number()); } else m.scores.push(r.number()); break;
      case 12: var c3 = r.number() + r.pos; value = 0; while (r.pos < c3) { var tag = r.number(); switch (tag >>> 3) { case 1: value += r.number(); break; case 2: value += r.signed(); break; default: r.skip(tag & 7); } } m.total += value; break;
      default: r.skip(t & 7); break; } }
    return m;
  };
  return Person;
})();
const turns = +(process.argv[2] ?? 50); let sum = 0;
for (let t = 0; t < turns; t++) { const made = Person.decode(new Uint8Array([42, 2, 5, 6, 98, 4, 8, 7, 16, 3, 40, 9, 24, 1])); sum += made.scores.length * 100 + made.total; }
console.log(sum);
