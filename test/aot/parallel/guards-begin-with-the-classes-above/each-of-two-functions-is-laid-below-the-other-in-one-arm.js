// The text lays One below Two in one arm and Two below One in the other, and only one arm runs. In turn five unseen text turns the two round.
function One(a) { this.a = a; }
function Two(a) { this.a = a + 1; }
One.prototype.name = function () { return "one" + this.a; };
Two.prototype.name = function () { return "two" + this.a; };
if (globalThis.laysOneBelowTwo) Object.setPrototypeOf(One.prototype, Two.prototype);
else Object.setPrototypeOf(Two.prototype, One.prototype);
One.prototype.shared = function () { return "s" + this.a; };
globalThis.classes = { One, Two };
const change = (text) => (0, eval)(text);
function run(count) {
  let text = "";
  for (let i = 0; i < count; i++) {
    if (i === 5) change("Object.setPrototypeOf(classes.Two.prototype, Object.prototype); Object.setPrototypeOf(classes.One.prototype, classes.Two.prototype); classes.Two.prototype.shared = function () { return 't' + this.a; }; delete classes.One.prototype.shared;");
    const one = new One(i);
    const two = new Two(i);
    text += one.name() + two.name() + one.shared() + two.shared() + " ";
  }
  return text;
}
console.log(run(10));
