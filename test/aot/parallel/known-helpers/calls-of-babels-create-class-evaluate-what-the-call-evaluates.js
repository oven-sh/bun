// A call of Babel's _createClass with lists written out evaluates what the call evaluates: what stands in front of a comma in the callee, and `Constructor.prototype`
// wherever the helper is given a list, an empty one too.
function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }
function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }
function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "threw", error.name);
  }
}
var n = 0;
function V() {}
(n++, _createClass)(V, [{ key: "a", value: function a() {} }]);
console.log("counted", n, typeof V.prototype.a);
function W() {}
(0, _createClass)(W, [{ key: "b", value: function b() {} }]);
("x", null, _createClass)(W, [{ key: "c", value: function c() {} }]);
console.log("constants in front", typeof W.prototype.b, typeof W.prototype.c);
function said() {
  n += 10;
  return 0;
}
function X() {}
(said(), _createClass)(X, null, [{ key: "s", value: 1 }]);
console.log("called", n, X.s);

var nothing;
var none = null;
attempt("undefined, an empty list", () => (_createClass(nothing, []), "no throw"));
attempt("null, an empty list", () => (_createClass(none, []), "no throw"));
attempt("undefined, a list", () => (_createClass(nothing, [{ key: "a", value: 1 }]), "no throw"));
attempt("undefined, no list", () => (_createClass(nothing, null), "no throw"));
attempt("undefined, no list and an empty one", () => (_createClass(nothing, null, []), "no throw"));
attempt("undefined, no list and a list", () => (_createClass(nothing, null, [{ key: "a", value: 1 }]), "no throw"));

var reads = 0;
var holder = {
  get prototype() {
    reads++;
    return {};
  },
};
_createClass(holder, []);
console.log("an empty list reads", reads);
_createClass(holder, null);
console.log("no list reads", reads);
_createClass(holder, [], []);
console.log("two empty lists read", reads);
_createClass(holder, [{ key: "a", value: 1 }]);
console.log("a list reads", reads);
