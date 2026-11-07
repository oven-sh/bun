// `if (!(this instanceof Gauge)) return new Gauge(..)` stands at the head of constructor functions in many packages. In sloppy code `this` may be the global object there. That takes nothing of Bun's library.
// STATISTIC: FunctionsLowered <= 700
// STATISTIC: ImageFunctionsEmitted <= 5
function Gauge(start) {
  if (!(this instanceof Gauge)) return new Gauge(start);
  this.level = start;
}
console.log(Gauge(3).level, new Gauge(4).level);
