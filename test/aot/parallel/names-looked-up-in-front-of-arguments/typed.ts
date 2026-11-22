function Gauge(this: any, v: number) { this.v = v; }
let seen: unknown = "the getter did not run";
function makeHolder() {
  return {
    get run() {
      try { seen = new (Gauge as any)(6).next(); } catch (e) { seen = (e as Error).name; }
      return function (laid: unknown): string { return typeof laid; };
    },
  };
}
const above = Gauge.prototype;
const holder = makeHolder();
const kind = holder.run(above.next = function (this: any): number { return this.v + 1; });
console.log(kind, seen, new (Gauge as any)(1).next());
