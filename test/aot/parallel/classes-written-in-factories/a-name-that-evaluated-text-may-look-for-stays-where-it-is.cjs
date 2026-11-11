// STATISTIC: PermanentClassCapturesPromoted = 0
(function (exports) {
  var kinds = { word: 3, end: 7 };
  var spare = { word: 30, end: 70 };
  var Reader = function Reader(text) {
    this.text = text;
    this.kinds = kinds;
  };
  Reader.prototype.look = function (name) {
    return eval(name);
  };
  Reader.prototype.weigh = function () {
    return kinds.word * this.text.length + this.kinds.end;
  };
  Reader.prototype.within = function (scope) {
    with (scope) {
      return kinds.word + spare.end;
    }
  };
  exports.Reader = Reader;
})(exports);
var out = [];
var one = new exports.Reader("abcd");
for (var turn = 0; turn < 12; turn++) out.push(one.weigh());
out.push(one.look("kinds") === one.kinds, one.look("kinds.end"), one.look("kinds = spare, 1"), one.weigh(), new exports.Reader("ab").weigh(), one.look("kinds") === one.kinds);
out.push(one.within({}), one.within({ kinds: { word: 1000 } }), one.within({ spare: { end: 5 } }));
console.log(out.slice(-10).join(" "));
