// A number and a string are stored as the prototype property of a plain function: what it constructs lies below Object.prototype. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const Meter = hide(function Meter() {});
const told = [];
for (const value of [5, "text", undefined, true, Symbol.iterator]) {
  Meter.prototype = value;
  const meter = new Meter();
  told.push(Object.getPrototypeOf(meter) === Object.prototype, typeof Meter.prototype);
}
console.log(told.join());
