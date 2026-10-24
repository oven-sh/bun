function sum(list) {
  var total = 0;
  for (var i = 0; i < list.length; i++) total += list[i];
  return total;
}

function double(n) {
  return n * 2;
}

function span(point) {
  return point.x - point.y;
}

function whoCalls() {
  return this === undefined ? "undefined" : this === globalThis ? "the global object" : this === module.exports ? "the exports" : typeof this;
}

module.exports = { sum: sum, double: double, span: span, whoCalls: whoCalls };
