// A construction answers what the function returns where that is an object, and the new object where it is a primitive.
const other = { other: true };
function Meter(answer) { this.own = true; return answer; }
Meter.prototype.read = function () { return "read"; };
const told = [];
for (const answer of [other, 5, null, undefined, "s", [1], function () {}]) {
  const made = new Meter(answer);
  told.push(made === answer, made.own === true, typeof made.read);
}
console.log(told.join());
