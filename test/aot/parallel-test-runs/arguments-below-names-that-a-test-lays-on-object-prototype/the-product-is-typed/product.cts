function probe(first: string) {
  var work = 0; for (var i = 0; i < 2; i++) work = (work + i) | 0;
  var seen = (arguments as any).extra;
  return first + ":" + seen;
}
module.exports = { probe };
