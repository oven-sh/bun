// A function whose name stands nowhere but as an argument. What the callee does with the parameter says what it is: `new`, `.prototype` and `instanceof` are done to constructors; a function that is only called stays what it was.
function made(Constructor, value) { return new Constructor(value); }
function withMethod(Constructor) { Constructor.prototype.twice = function () { return this.held * 2; }; return Constructor; }
function check(instance, Constructor) { if (!(instance instanceof Constructor)) throw new TypeError("called without new"); }
function handedOn(Constructor) { return withMethod(Constructor); }
function calledOn(receiver, callback) { callback.call(receiver, 5); return receiver; }

var byNew = (function () {
  function Made(value) { this.held = value; }
  return made(Made, 3);
})();
var ByPrototype = (function () {
  function Held(value) { this.held = value; }
  return withMethod(Held);
})();
var ByInstanceof = (function () {
  function Checked(value) { check(this, Checked); this.held = value; }
  return [Checked][0];
})();
var ByTwoSteps = (function () {
  function Far(value) { this.held = value; }
  return handedOn(Far);
})();
var filled = (function () {
  function fill(value) { this.held = value; this.more = value + 1; }
  return calledOn({ first: 1 }, fill);
})();

console.log(byNew.held, Object.keys(byNew).join(), byNew.constructor.name);
console.log(new ByPrototype(4).twice(), new ByTwoSteps(6).twice(), new ByInstanceof(7).held);
try {
  ByInstanceof(1);
} catch (error) {
  console.log(error.name, error.message);
}
console.log(JSON.stringify(filled), Object.keys(filled).join());
var sum = 0;
for (var i = 0; i < 100; i++) sum += new ByPrototype(i).twice() + new ByTwoSteps(i).held + new ByInstanceof(i).held;
console.log(sum);
