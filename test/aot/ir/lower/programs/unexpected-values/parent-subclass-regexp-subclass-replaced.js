// RUN: lower
// OPTIONS: builtin-modules

// The parent of a subclass of a regexp subclass is replaced by a constructor function.
class B extends RegExp {}
class C extends B {}
const X = function () {};
Object.defineProperty(X.prototype, "exec", {
  value: function (text) {
    return null;
  },
});
X.prototype.__proto__ = RegExp.prototype;
C.__proto__ = X;
console.log(new B("a").test("a"));

// CHECK-LABEL: function {{*}}name="B"
// CHECK-LABEL: function {{*}}name="X"
// CHECK-LABEL: function {{*}}name="value"
