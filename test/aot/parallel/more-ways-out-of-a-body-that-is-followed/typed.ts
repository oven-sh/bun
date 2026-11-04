const attempt = (f: () => unknown) => { try { return f(); } catch (e) { return 'threw ' + (e as Error).name; } };
interface Gauge { v: number; next(): number; }
function Gauge(this: Gauge, v: number) { this.v = v; }
function note(): number { return 0; }
function read(K: new (v: number) => Gauge): number { let t = 0; for (let i = 0; i < 300; i++) t += new K(i & 3).next(); return t; }
(function (): number | void {
  if (process.argv.length < 99) return note();
  Gauge.prototype.next = function (this: Gauge): number { return this.v + 1; };
})();
console.log(attempt(() => read(Gauge as unknown as new (v: number) => Gauge)));
