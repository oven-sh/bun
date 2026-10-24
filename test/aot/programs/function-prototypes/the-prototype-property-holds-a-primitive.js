// A number and a string are stored as the prototype property of a plain function: what it constructs lies below Object.prototype.
function Meter() {}
const told = [];
for (const value of [5, "text", undefined, true, Symbol.iterator]) {
  Meter.prototype = value;
  const meter = new Meter();
  told.push(Object.getPrototypeOf(meter) === Object.prototype, typeof Meter.prototype);
}
console.log(told.join());
