// `instanceof` where a prototype property was assigned: Object.prototype itself, one object for two constructor functions, the prototype object of a class, and another object after a class below was defined.
function Plain() {}
Plain.prototype = Object.prototype;
function First() { this.a = 1; }
function Second() { this.b = 2; }
const shared = { kind: "shared" };
First.prototype = shared;
Second.prototype = shared;
function Meter() {}
const early = { early: true };
Meter.prototype = early;
class Fine extends Meter {}
Meter.prototype = { late: true };
class Base {}
function Borrower() {}
Borrower.prototype = Base.prototype;
class Derived extends Base {}
function check() {
  const rows = [];
  rows.push(["literal instanceof Plain", {} instanceof Plain]);
  rows.push(["array instanceof Plain", [] instanceof Plain]);
  rows.push(["new First instanceof Second", new First() instanceof Second]);
  rows.push(["new Second instanceof First", new Second() instanceof First]);
  rows.push(["new Fine instanceof Meter", new Fine() instanceof Meter]);
  rows.push(["new Meter instanceof Meter", new Meter() instanceof Meter]);
  rows.push(["new Base instanceof Borrower", new Base() instanceof Borrower]);
  rows.push(["new Derived instanceof Borrower", new Derived() instanceof Borrower]);
  rows.push(["new Borrower instanceof Base", new Borrower() instanceof Base]);
  rows.push(["created instanceof First", Object.create(shared) instanceof First]);
  return rows;
}
for (let round = 0; round < 3; round++) for (const [name, answer] of check()) console.log(round, name, answer);
