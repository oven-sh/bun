// Assertions leave nothing behind in the program that runs, however many: this is a store to Gauge.High.
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
((Gauge.High as unknown)! as number) = 9;
console.log(pick(1), pick(9), Gauge.High);
