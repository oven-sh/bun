var unseen = new Function("x", "return x");
class Failure extends Error {
  static make(text) { return new Failure(text); }
  describe() { return "failure " + this.message; }
  get kind() { return "plain"; }
}
class Worse extends Failure {
  describe() { return "worse " + super.describe(); }
}
class Bag extends Map {
  static of(key, value) { var bag = new Bag(); bag.set(key, value); return bag; }
  first() { return this.keys().next().value; }
}
class Row extends Array {
  sum() { var total = 0; for (var index = 0; index < this.length; index++) total += this[index]; return total; }
}
function ask() {
  var failure = Failure.make("a");
  var worse = new Worse("b");
  var bag = Bag.of("k", 1);
  var row = Row.from([1, 2, 3]);
  return [failure.describe(), failure.kind, worse.describe(), worse.kind, bag.first(), bag.size, row.sum(), row.length, Row.isArray(row), typeof Failure.captureStackTrace,
    failure instanceof Failure, worse instanceof Failure, worse instanceof Error, bag instanceof Map, row instanceof Row, failure.toString(), Failure.name, Worse.length].join(" | ");
}
for (var round = 0; round < 3; round++)
  console.log(ask());
unseen(Failure).prototype.describe = function () { return "replaced " + this.message; };
console.log(ask());
Object.defineProperty(unseen(Failure).prototype, "kind", { get: function () { return "other"; }, configurable: true });
console.log(ask());
unseen(Failure).make = function (text) { return new Worse(text + "!"); };
console.log(ask());
Object.setPrototypeOf(unseen(Worse).prototype, Error.prototype);
try { console.log(ask()); } catch (error) { console.log(error.name); }
Object.setPrototypeOf(unseen(Worse).prototype, Failure.prototype);
console.log(ask());
Object.setPrototypeOf(unseen(Bag), Object);
console.log(typeof Bag.groupBy, typeof Bag.keys);
unseen(Row).prototype.sum = undefined;
try { console.log(ask()); } catch (error) { console.log(error.name); }
