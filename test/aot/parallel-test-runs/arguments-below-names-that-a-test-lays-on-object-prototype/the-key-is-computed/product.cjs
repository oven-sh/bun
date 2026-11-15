var key = JSON.parse('"extra"');
function probe(first) {
  var work = 0; for (var i = 0; i < 2; i++) work = (work + i) | 0;
  var seen = arguments[key];
  return first + ":" + seen;
}
module.exports = { probe };
