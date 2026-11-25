var Gauge = (function () {
  function Gauge(start) { this.level = start; }
  Gauge.prototype.rise = function (by) { this.level += by; return this.level; };
  return Gauge;
})();
const gauge = new Gauge(2);
console.log(gauge.rise(3), gauge instanceof Gauge, Object.getPrototypeOf(gauge) === Gauge.prototype, Gauge.name);
