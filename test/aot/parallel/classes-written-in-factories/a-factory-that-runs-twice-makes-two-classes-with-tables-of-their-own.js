// STATISTIC: CapturesOfClassesStoredForGoodPromoted = 0
"use strict";
const hide = value => [value][JSON.parse("0")];
function factory(exports, weight) {
  var kinds = { word: { weight: weight }, end: { weight: weight * 2 } };
  var seen = [];
  var Reader = function Reader(text) {
    this.text = text;
    this.at = 0;
    this.kind = kinds.end;
    seen.push(text.length);
  };
  Reader.read = function read(text) {
    return new this(text).all();
  };
  var pp = Reader.prototype;
  pp.step = function () {
    this.at = this.at + kinds.word.weight;
    this.kind = kinds.word;
  };
  pp.all = function () {
    while (this.at < this.text.length) this.step();
    return this.at * 100 + this.kind.weight + seen.length;
  };
  exports.Reader = Reader;
  exports.swap = function () {
    kinds = { word: { weight: weight + 1 }, end: { weight: 1 } };
  };
}
const first = {}, second = {};
factory(first, 2);
factory(second, 5);
const out = [];
for (let round = 0; round < 14; round++) out.push(hide(first.Reader).read("abcdefg"), hide(second.Reader).read("abcdefg"));
first.swap();
out.push(hide(first.Reader).read("abcdefg"), hide(second.Reader).read("abcdefg"), first.Reader === second.Reader, first.Reader.prototype.all.call(new second.Reader("xy")));
console.log(out.slice(-8).join());
