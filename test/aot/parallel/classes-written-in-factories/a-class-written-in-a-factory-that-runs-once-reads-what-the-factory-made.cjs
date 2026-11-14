// STATISTIC: PermanentClassCapturesPromoted >= 3
(function (root, factory) {
  typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : factory((root.readers = {}));
})(this, function (exports) {
  "use strict";
  var kinds = { word: { label: "word", weight: 3 }, mark: { label: "mark", weight: 5 }, end: { label: "end", weight: 7 } };
  var breaks = /[\n;]/;
  var limits = [97, 122];
  var counted = 0;
  var Reader = function Reader(text) {
    this.text = String(text);
    this.at = 0;
    this.kind = kinds.end;
    this.sum = 0;
    this.lines = breaks.test(this.text) ? 2 : 1;
    this.low = limits[0];
    counted++;
  };
  Reader.read = function read(text) {
    return new this(text).all();
  };
  Reader.counted = function () {
    return counted;
  };
  var pp = Reader.prototype;
  pp.peek = function () {
    return this.text.charCodeAt(this.at);
  };
  pp.isWord = function (unit) {
    return unit >= limits[0] && unit <= limits[1];
  };
  pp.next = function () {
    if (this.at >= this.text.length) return this.finish(kinds.end);
    var unit = this.peek();
    this.at++;
    if (!this.isWord(unit)) return this.finish(kinds.mark);
    while (this.isWord(this.peek())) this.at++;
    return this.finish(kinds.word);
  };
  pp.finish = function (kind) {
    this.kind = kind;
    this.sum = (this.sum * 31 + kind.weight + this.at) % 65521;
    return kind;
  };
  pp.all = function () {
    while (this.next() !== kinds.end);
    return this.sum * this.lines + this.low;
  };
  exports.Reader = Reader;
  exports.kinds = kinds;
  exports.widen = function () {
    limits = [48, 122];
  };
});
const hide = value => [value][JSON.parse("0")];
const { Reader, kinds, widen } = exports;
const texts = JSON.parse('["alpha beta;gamma", "x", "", "one two three\\nfour", "a1b2c3 d4", "  ;; "]');
const out = [];
for (let round = 0; round < 14; round++) for (const text of texts) out.push(hide(Reader).read(text));
kinds.word.weight = 11;
for (const text of texts) out.push(hide(Reader).read(text));
widen();
for (const text of texts) out.push(hide(Reader).read(text));
const stranger = { text: "zz top", at: 0, sum: 0, lines: 3, low: 1, kind: null, peek: Reader.prototype.peek, isWord: () => false, next: Reader.prototype.next, finish: Reader.prototype.finish };
out.push(Reader.prototype.all.call(stranger), stranger.kind.label);
class Heir extends Reader { peek() { return super.peek() | 32; } }
out.push(Heir.read("ABC def"), new Heir("Q;").all());
Reader.prototype.isWord = function (unit) { return unit === 97; };
for (const text of texts) out.push(hide(Reader).read(text));
function nameOfWhatIsThrown(run) { try { run(); } catch (error) { return error instanceof TypeError ? "TypeError" : "another"; } }
out.push(nameOfWhatIsThrown(() => Reader.prototype.all.call(undefined)));
console.log(out.length, out.slice(-26).join(), Reader.counted());
