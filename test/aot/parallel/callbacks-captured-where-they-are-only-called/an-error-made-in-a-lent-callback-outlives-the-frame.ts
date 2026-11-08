const errors: Error[] = [];
function each(list: number[], visit: (x: number) => void): void { for (let i = 0; i < list.length; i++) visit(list[i]); }
function viaHelper(list: number[], k: number): void { each(list, x => { if (x === k) errors.push(new Error("helper " + x)); }); }
function viaMethod(list: number[], k: number): void { list.forEach(x => { if (x === k) errors.push(new Error("method " + x)); }); }
const buses: any[] = (JSON.parse("[0,1]") as number[]).map(n => n ? { run(f: () => void) { f(); } } : { run(f: () => void) { f(); f(); } });
function viaName(bus: any, k: number): void { bus.run(() => { errors.push(new Error("name " + k)); }); }
function thrown(list: number[], k: number): void { try { each(list, x => { if (x === k) throw new Error("thrown " + x); }); } catch (e) { errors.push(e as Error); } }
function tread(n: number): number { const a = [n, n + 1, n + 2]; return n ? tread(n - 1) + a[n % 3] : 0; }
for (let round = 0; round < 40; round++) {
  viaHelper([1, 2, 3], round % 4); viaMethod([1, 2, 3], round % 4); viaName(buses[round % 2], round); thrown([1, 2, 3], round % 4);
  tread(200);
  if (round % 8 === 0) Bun.gc(true);
}
tread(500); Bun.gc(true);
let frames = 0;
for (const e of errors) frames += String(e.stack).split("\n").length > 1 ? 1 : 0;
Bun.gc(true);
console.log(errors.length, frames, errors.map(e => e.message).slice(0, 6).join());
function sloppyCaller() { return 1; }
console.log(sloppyCaller());
