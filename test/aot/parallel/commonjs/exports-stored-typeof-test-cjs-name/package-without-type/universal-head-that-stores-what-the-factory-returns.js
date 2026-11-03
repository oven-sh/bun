(function (root, factory) {
  if (typeof exports === "object" && typeof module === "object") module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else if (typeof exports === "object") exports["lib"] = factory();
  else root["lib"] = factory();
})(this, function () {
  return {
    foo: function () {
      return "foo";
    },
  };
});
