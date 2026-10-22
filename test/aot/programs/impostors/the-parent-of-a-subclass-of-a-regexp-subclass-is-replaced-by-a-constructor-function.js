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
