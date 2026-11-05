// Sloppy code: called without `new`, `this` is the global object. A variable takes it inside `try`, and the catch block uses the variable, all ahead of `this instanceof F`.
function fail() {
  throw new Error("thrown");
}

function Stores(value) {
  var taken = null;
  try {
    taken = this;
    fail();
  } catch (error) {
    taken.storedByCatchBlock = value;
  }
  if (!(this instanceof Stores)) return new Stores(value);
  this.value = value;
}
var stored = Stores(5);
console.log(stored.value, typeof storedByCatchBlock, globalThis.storedByCatchBlock, "storedByCatchBlock" in globalThis);
console.log(stored.storedByCatchBlock, Object.keys(stored).join());

var kept = [];
function Keeps(value) {
  var taken = null;
  try {
    taken = this;
    fail();
  } catch (error) {
    kept.push(taken);
  }
  if (!(this instanceof Keeps)) return new Keeps(value);
  this.value = value;
}
var made = Keeps(6);
console.log(made.value, kept.length, kept[0] === globalThis, kept[1] === made);
kept[0].storedLater = 1;
console.log(typeof storedLater, globalThis.storedLater);

var finished = 0;
function Counts(value) {
  try {
    if (!(this instanceof Counts)) return new Counts(value);
  } finally {
    finished++;
  }
  this.value = value;
}
console.log(Counts(1).value, new Counts(2).value, finished, typeof value);
