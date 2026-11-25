function Gauge(v) { this.v = v; }
let seen = "the getter did not run";
function makeHolder() {
  return {
    get run() {
      try { seen = new Gauge(6).next(); } catch (e) { seen = e.name; }
      return (texts, laid) => texts.length + typeof laid;
    },
  };
}
const above = Gauge.prototype;
const holder = makeHolder();
const kind = holder.run`a${above.next = function () { return this.v + 1; }}b`;
console.log(kind, seen, new Gauge(1).next());
