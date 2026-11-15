// A call off the object hands it over as the receiver, through an assertion too.
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
Gauge.raise = function (this: any) {
  this.High = 9;
};
(Gauge.raise as any)();
console.log(pick(1), pick(9), Gauge.High);
