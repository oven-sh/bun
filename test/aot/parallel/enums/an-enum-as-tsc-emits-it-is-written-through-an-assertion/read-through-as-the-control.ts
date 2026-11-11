// THE CONTROL: a read through an assertion writes nothing.
var Gauge: any;
(function (Gauge: any) {
  Gauge[(Gauge["Low"] = 0)] = "Low";
  Gauge[(Gauge["High"] = 1)] = "High";
})(Gauge || (Gauge = {}));
function pick(level: number) {
  switch (level) {
    case Gauge.Low:
      return "low";
    case Gauge.High:
      return "high";
    default:
      return "?";
  }
}
const read = (Gauge.High as number) + <number>Gauge.Low + Gauge.High!;
console.log(read);
console.log(pick(1), pick(9), Gauge.High);
