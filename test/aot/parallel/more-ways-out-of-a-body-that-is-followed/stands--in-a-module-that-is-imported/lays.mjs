export function Gauge(v) { this.v = v; }
function note() { return 0; }
(function () {
  Gauge.prototype.next = function () { return this.v + 1; };
  return note();
})();
