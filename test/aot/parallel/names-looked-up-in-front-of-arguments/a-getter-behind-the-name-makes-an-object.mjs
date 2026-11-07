function Gauge(v) { this.v = v; }
let seen = "the getter did not run";
function makeHolder() {
  return {
    get run() {
      try { seen = new Gauge(6).next(); } catch (e) { seen = e.name; }
      return function (laid) { return typeof laid; };
    },
  };
}
const above = Gauge.prototype;
const holder = makeHolder();
holder.run(above.next = function () { return this.v + 1; });
console.log(seen);
console.log(new Gauge(1).next());
