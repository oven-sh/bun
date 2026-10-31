// Text that is evaluated at run time puts `next` and `return` on built-in prototypes that stay open. A loop asks whatever Symbol.iterator answers for them, and the functions change their receiver.
const glue = (first, second) => [first, second].join(process.argv.length > 99 ? "x" : "");
const plant = text => new Function(glue(text, ""))();

const when = new WeakRef({});
when.turns = 0;
when.closed = 0;
const overReference = { [Symbol.iterator]() { return when; } };
function twice(read) {
  let sum = 0;
  for (let round = 0; round < 2; round++) sum += read();
  return sum;
}
plant(`WeakRef.prototype.next = function () { this.turns = this.turns + "t"; return { done: this.turns.length > 3, value: this.turns }; }`);
plant(`WeakRef.prototype.return = function () { this.closed = "closed"; return {}; }`);
let seen = "";
for (const value of overReference) seen += value + " ";
console.log("a weak reference as an iterator:", seen, twice(() => when.turns), twice(() => when.closed));
when.turns = 0;
for (const value of overReference) break;
console.log("left early:", twice(() => when.turns), twice(() => when.closed));

const failure = new RangeError("out of range");
failure.turns = 0;
const overError = { [Symbol.iterator]() { return failure; } };
plant(`Error.prototype.next = function () { this.turns = this.turns + "e"; return { done: this.turns.length > 2, value: 1 }; }`);
console.log("an error as an iterator:", [...overError].length, twice(() => failure.turns));
console.log("handed to a built-in:", Array.from(overError).length, new Set(overError).size, twice(() => failure.turns));

const day = new Date(0);
day.turns = 0;
const overDate = { [Symbol.iterator]() { return day; } };
plant(`Date.prototype.next = function () { this.turns = this.turns + "d"; return { done: this.turns.length > 3, value: this.turns }; }`);
console.log("a date as an iterator, by the one name that is open there:", [...overDate].join(), twice(() => day.turns));
