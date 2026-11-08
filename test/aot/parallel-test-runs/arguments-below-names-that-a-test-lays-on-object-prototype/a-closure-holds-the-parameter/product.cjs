function probe(first) {
  var work = 0; for (var i = 0; i < 2; i++) work = (work + i) | 0;
  var read = function () { return first; };
  var seen = typeof arguments.extra;
  return read() + ":" + seen;
}
module.exports = { probe };
