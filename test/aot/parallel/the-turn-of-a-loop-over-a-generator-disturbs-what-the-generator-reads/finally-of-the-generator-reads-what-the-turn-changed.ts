// The loop of a generator is walked with the turn of its consumer inside it: finally of the generator reads what the turn changed.
class Log { hits = 0; seen = -1; }
class Shelf {
  constructor(public a: number[], public log: Log) {}
  *[Symbol.iterator](): Generator<number> {
    const log = this.log; log.hits = 0;
    try { for (let i = 0; i < this.a.length; i++) yield this.a[i]; } finally { log.seen = log.hits; }
  }
}
function scan(s: Shelf, stop: number, fails: boolean): number {
  let sum = 0;
  try { for (const v of s) { s.log.hits += 1; if (v === stop) { if (fails) throw new RangeError("stop"); break; } sum += v; } } catch (e) { sum += 1000; }
  return sum;
}
const one = new Shelf([5, 6, 7, 8], new Log()), two = new Shelf([5, 6, 7, 8], new Log()), three = new Shelf([5, 6], new Log());
console.log(scan(one, 7, JSON.parse("false")), one.log.seen, scan(two, 6, JSON.parse("true")), two.log.seen, scan(three, 9, JSON.parse("false")), three.log.seen);
