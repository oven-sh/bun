// An assertion leaves nothing behind in the program that runs: each turn stores a key to Gauge.High.
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
for (Gauge.High as any in { 9: true });
console.log(pick(1), pick(9), Gauge.High);
