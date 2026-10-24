// One call site calls a method of the prototype object of a plain function twice, and between the two calls another function is stored under the name.
function Meter() {}
Meter.prototype.read = function () { return 1; };
const meter = new Meter();
const seen = [];
for (let round = 0; round < 2; round++) {
  const answer = meter.read();
  seen.push(typeof answer === "number" ? answer + 1 : answer.length);
  Meter.prototype.read = function () { return "four"; };
}
console.log(seen.join());
