function later(first) {
  var work = 0; for (var i = 0; i < 2; i++) work = (work + i) | 0;
  var held = arguments.keeper;
  first = "stored";
  return held[0];
}
module.exports = { later };
