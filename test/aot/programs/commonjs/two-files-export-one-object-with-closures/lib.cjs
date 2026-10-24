(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.lib = factory();
})(this, function () {
  var calls = 0;
  return {
    first: function () { return "first " + ++calls; },
    second: function () { return "second " + ++calls; },
    third: function () { return "third " + ++calls; },
    fourth: function () { return "fourth " + ++calls; },
  };
});
