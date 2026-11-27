// Loops inside try blocks over arrays in fields of number, int32 and whole numbers. What they store into fields and into the arrays is read by the catch, the finally and the next iteration.
// STATISTIC: UnrolledLoopsWithSlotStores >= 6
const out: string[] = [];
const log = (word: unknown) => { out.push(String(word)); };
const show = (v: any): string => (Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : String(v));
const message = (e: any): string => (e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : String(e?.message ?? e));
class Masked {
  n = 0; list: number[] = [];
  constructor(size: number) { for (let k = 0; k < size; k++) this.list.push(k); }
  caught(): number { try { for (let k = 0; k < this.list.length; k++) this.n = (this.n + this.list[k]) & 1023; } catch { return -1; } return this.n; }
  ended(): number { try { for (let k = 0; k < this.list.length; k++) this.n = (this.n + this.list[k]) & 1023; } finally { log("ended " + this.n); } return this.n; }
  rereads(): number { let s = 0; try { for (let k = 0; k < this.list.length; k++) { const before = this.list[k]; this.list[k] = before ^ 5; this.n = this.list[k]; s += this.list[k] - before; } } catch (e) { log(message(e)); } return s + this.n; }
  shifts(): number { let s = 0; try { for (let k = 0; k + 1 < this.list.length; k++) { s += this.list[k + 1]; this.list[k + 1] = this.list[k]; this.n = s - this.list[k + 1]; } } finally { log("shifted " + show(this.list.slice(0, 4))); } return this.n; }
  stores(): number { const list = this.list; try { for (let k = 0; k < list.length; k++) { this.n = (this.n + list[k]) & 1023; list[k] = this.n & 63; } } catch (e) { log(message(e)); } return this.n; }
}
class Wide {
  n = 0; list: number[] = [];
  constructor(size: number) { for (let k = 0; k < size; k++) this.list.push(2147483640 + k); }
  caught(): number { try { for (let k = 0; k < this.list.length; k++) this.n = (this.n + this.list[k]) | 0; } catch { return -1; } return this.n; }
  sums(): number { try { for (let k = 0; k < this.list.length; k++) this.n += this.list[k]; } finally { log("wide " + this.n); } return this.n; }
  swaps(): number { try { for (let k = 1; k < this.list.length; k++) { const x = this.list[k]; this.list[k] = this.list[k - 1]; this.list[k - 1] = x; this.n = this.list[k] - this.list[0]; } } catch (e) { log(message(e)); } return this.n + this.list[0]; }
}
class Sums {
  sum = 0; list: number[] = [];
  constructor(size: number, step: number) { for (let k = 0; k < size; k++) this.list.push(k * step); }
  caught(): number { try { for (let k = 0; k < this.list.length; k++) this.sum += this.list[k]; } catch { return -1; } return this.sum; }
  ended(stop: number): number { try { for (let k = 0; k < this.list.length; k++) { this.sum += this.list[k]; if (this.list[k] === stop) throw new Error("stop " + k); } } finally { log("sum " + show(this.sum)); this.sum = 0; } return this.sum; }
  rereads(): number { let s = 0; try { for (let k = 0; k < this.list.length; k++) { const before = this.list[k]; this.list[k] = before + 1; this.sum = this.list[k]; s += this.list[k] - before; } } catch (e) { log(message(e)); } return s + this.sum; }
  shifts(): number { let s = 0; try { for (let k = 0; k + 1 < this.list.length; k++) { s += this.list[k + 1]; this.list[k + 1] = this.list[k]; s -= this.list[k + 1]; this.sum = s; } } finally { log("shifted " + show(this.list.slice(0, 4))); } return this.sum; }
  grows(stop: number): number { let n = 0; try { for (let k = 0; k < this.list.length && k < 50; k++) { this.sum += this.list[k]; if (k === stop) this.list.push(0.5); if (k === stop + 1) this.list[k] = 2147483648.5; n++; if (n > 40) throw new RangeError("long"); } } catch (e) { log(message(e) + n); } return this.sum; }
  nested(): number { for (let r = 0; r < 3; r++) { try { for (let k = r; k < this.list.length; k++) { try { this.sum = (this.sum * 3 + this.list[k]) % 9973; } finally { this.sum += r; } } } catch { this.sum = -1; } } return this.sum; }
  async waits(): Promise<number> { try { for (let k = 0; k < this.list.length; k++) { this.sum += this.list[k]; if (k === 3) await null; } } finally { log("waited " + show(this.sum)); } return this.sum; }
}
async function main() {
  for (const size of [0, 1, 5, 8, 33]) {
    const m = new Masked(size);
    for (let r = 0; r < 4; r++) log([m.caught(), m.ended(), m.rereads(), m.shifts(), m.stores()].map(show).join());
    const w = new Wide(size);
    for (let r = 0; r < 4; r++) log([w.caught(), w.sums(), w.swaps()].map(show).join());
    for (const step of [1, 3, -2, 0.5, 1e9, 2147483647, 1 << 30]) {
      const s = new Sums(size, step);
      for (let r = 0; r < 3; r++) log([s.caught(), s.rereads(), s.shifts(), s.nested(), await s.waits()].map(show).join());
      for (const stop of [0, step, 2 * step, -1]) { try { log(show(s.ended(stop))); } catch (e) { log(message(e)); } log(show([s.grows(stop), s.list.length])); }
      (s.list as any)[1] = r1; try { log(show(s.caught())); } catch (e) { log(message(e)); }
    }
  }
}
const r1: any = "text";
await main();
let digest = 0;
for (const line of out) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, digest);
if (process.argv[2] === "all") console.log(out.join("\n"));
else console.log(out.filter((_, i) => i % 7 === 0 || i < 40).join("\n"));
