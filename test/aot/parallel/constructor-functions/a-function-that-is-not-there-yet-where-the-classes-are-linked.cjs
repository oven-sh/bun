// `Derived.prototype = new Base()` in front of `var Base = function () { .. }`.
function Derived() {}
var said = "nothing";
try {
  Derived.prototype = new Base();
} catch (error) {
  said = error.constructor.name + ": " + error.message;
}
var Base = function () {
  this.own = 1;
};
console.log(said, Derived.prototype.constructor === Derived);
Derived.prototype = new Base();
console.log(new Derived().own);
