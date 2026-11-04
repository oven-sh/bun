const attempt = (f: () => unknown) => { try { return f(); } catch (e) { return 'threw ' + (e as Error).name; } };
class Gauge { v: number; constructor(v: number) { this.v = v; } }
interface Gauge { next(): number; }
function note(): number { return 0; }
function read(): number { let t = 0; for (let i = 0; i < 300; i++) t += new Gauge(i & 3).next(); return t; }
(function (): number | void {
  if (process.argv.length < 99) return note();
  Gauge.prototype.next = function (this: Gauge): number { return this.v + 1; };
})();
console.log(attempt(read));
