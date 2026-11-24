// A method of a class is read in a loop in front of the class, in a function that runs once.
"use strict";
const lines = [];
globalThis.kinds = {};
globalThis.kinds.Parcel = function Parcel(weight) {
  this.weight = weight;
};
globalThis.kinds.Parcel.prototype.unit = "kg";
function ship() {
  kinds = globalThis.kinds;
  for (; turns; turns--) {
    note(parcel.cost);
  }
  class Express extends kinds.Parcel {
    cost() {
      return super.unit;
    }
  }
  const made = new Express(4);
  note(made.cost(), made.weight);
  parcel = made;
  for (turns = 2; turns; turns--) note(parcel.cost === Express.prototype.cost, parcel.cost());
}
globalThis.turns = 2;
globalThis.parcel = JSON.parse('{"cost":"cheap"}');
globalThis.note = (...values) => lines.push(values.join(":"));
try {
  if (lines.length === 0) ship();
} catch (error) {
  lines.push(error.name);
}
console.log(lines.join(" "));
