(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.lib = factory();
})(this, function () {
  var calls = 0;
  return {
    used: function () { return "used " + ++calls; },
    wrapped: function () { return "wrapped " + ++calls; },
    replaced: function () { return "replaced " + ++calls; },
    deleted: function () { return "deleted " + ++calls; },
    redefined: function () { return "redefined " + ++calls; },
    readThenDeleted: function () { return "readThenDeleted " + ++calls; },
    untouched: function () { return "untouched " + ++calls; },
    neverAsked: function () { return "neverAsked " + ++calls; },
  };
});
