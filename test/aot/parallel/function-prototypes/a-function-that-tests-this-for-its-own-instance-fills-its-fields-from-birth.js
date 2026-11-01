// `if (!(this instanceof F)) throw ..` ahead of the stores, as Babel's _classCallCheck does it, in a function that stands inside another and so captures the variable that holds it. The test walks links and shows the object to nobody: the fields are filled from birth, and F.prototype is the one object it was born with.
// COUNT: branches <= 9100
// COUNT: arrivals <= 20
function check(instance, Constructor) {
  if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
}
var Inner = (function () {
  function Inner(a) {
    check(this, Inner);
    this.a = a;
    this.b = 2;
  }
  Object.defineProperty(Inner.prototype, "sum", { value: function sum() { return this.a + this.b; }, configurable: true, writable: true });
  Object.defineProperty(Inner, "prototype", { writable: false });
  return Inner;
})();
function turn(i) {
  return new Inner(i & 7).sum();
}
var sum = 0;
for (var i = 0; i < 3000; i++) sum += turn(i);
var refused;
try {
  Inner(1);
} catch (error) {
  refused = error.message;
}
console.log(sum, refused);
