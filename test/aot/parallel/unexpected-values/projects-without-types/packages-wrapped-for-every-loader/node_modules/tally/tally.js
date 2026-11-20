(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Tally = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  function Tally(start) {
    if (!(this instanceof Tally)) return new Tally(start);
    this.value = start || 0;
    this.steps = [];
  }
  Tally.prototype.add = function (by) {
    this.value += by;
    this.steps.push(by);
    return this;
  };
  Tally.prototype.valueOf = function () {
    return this.value;
  };
  Tally.sum = function (list) {
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i];
    return total;
  };
  return Tally;
});
