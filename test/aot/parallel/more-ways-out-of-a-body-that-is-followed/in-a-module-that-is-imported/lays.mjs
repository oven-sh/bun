export function Gauge(v) { this.v = v; }
function note() { return 0; }
(function () {
  if (process.argv.length < 99) return note();
  Gauge.prototype.next = function () { return this.v + 1; };
})();
