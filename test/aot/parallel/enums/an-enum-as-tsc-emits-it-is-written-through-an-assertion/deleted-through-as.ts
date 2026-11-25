// An assertion leaves nothing behind in the program that runs: this deletes Gauge.High.
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
// @ts-expect-error TS2703: the checker wants a property reference here. The program that runs has one.
delete (Gauge.High as any);
console.log(pick(1), pick(9), Gauge.High);
