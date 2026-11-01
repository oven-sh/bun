// Flags: --aot-verify-each-pass
// An object of a constructor function below another is taken away, so the tests that name its class are made to wait for the class. What they read changes with that.
function show(object) {
  return JSON.stringify(object) + " " + Object.keys(object).join() + " " + Object.getOwnPropertyNames(object).length;
}
function Root() {
  this.root = 0;
}
Root.prototype.where = function () {
  return "root " + this.root;
};
function Meter() {
  Root.call(this);
  this.made = 1;
}
Object.setPrototypeOf(Meter.prototype, Root.prototype);
Object.setPrototypeOf(Meter, Root);
class Fine extends Meter {
  extra = 2;
}
const fine = new Fine();
console.log(show(fine), fine.where(), fine instanceof Root, show(new Meter()));
