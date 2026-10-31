// Babel's helpers held in `const` below their first call: until the line has run, reading the name throws.
function make() {
  function V() {}
  _createClass(V, [{ key: "a", value: function a() { return "a"; } }]);
  return V;
}
function attempt(label) {
  try {
    console.log(label, new (make())().a());
  } catch (error) {
    console.log(label, "threw", error.name);
  }
}
attempt("ahead of both");
const _defineProperties = function (target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } };
attempt("between them");
const _createClass = function (Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; };
attempt("behind both");
