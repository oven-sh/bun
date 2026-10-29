// Literals with the names of the literals of main.cjs, in the same order, that hold other kinds of values. No object made here meets one made there.
function halves(x) {
  return { a: x, b: x * 0.5 };
}
function halvesOfThree(x) {
  return { a: x, b: x * 0.5, c: x };
}
function labels(x) {
  return { d: x, e: "label " + x };
}
function labelsOfThree(x) {
  return { d: x, e: "label " + x, f: x };
}
function neighbors(x) {
  return { g: x | 0, h: (x + 1) | 0 };
}
function neighborsOfThree(x) {
  return { g: x | 0, h: (x + 1) | 0, i: (x + 2) | 0 };
}
module.exports = { halves, halvesOfThree, labels, labelsOfThree, neighbors, neighborsOfThree };
