function probe(first) {
  var work = 0; for (var i = 0; i < 2; i++) work = (work + i) | 0;
  first = "stored";
  return arguments?.peek;
}
module.exports = { probe };
