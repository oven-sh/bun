// An assertion leaves nothing behind in the program that runs: this steps Gauge.High.
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
for (let turn = 0; turn < 8; turn++) (Gauge.High as number)++;
console.log(pick(1), pick(9), Gauge.High);
