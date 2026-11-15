function probe(first) {
  var work = 0; for (var i = 0; i < 2; i++) work = (work + i) | 0;
  var read = () => arguments.extra;
  var seen = read();
  return first + ":" + seen;
}
module.exports = { probe };
