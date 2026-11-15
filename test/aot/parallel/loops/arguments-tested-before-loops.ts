// A loop of a method that unknown code may call passes two of its arguments to a small function with declared types in every iteration: they are tested once, before the loop.
// STATISTIC: UnrolledLoopsEmitted >= 9
const box: any = {}, SLOT = JSON.parse('"slot"');
function unknown(value: any) { box[SLOT] = value; return box[SLOT]; }
function distance(ax: number, ay: number, bx: number, by: number) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
class Points {
  coords: any;
  ids: Uint16Array;
  constructor(coords: any) { this.coords = coords; this.ids = new Uint16Array(coords.length / 2); for (let i = 0; i < this.ids.length; i++) this.ids[i] = i * 3; }
  within(x: any, y: any, radius: number, out: any) {
    const coords = this.coords, ids = this.ids, square = radius * radius;
    let count = 0;
    for (let i = 0; i < ids.length; i++) { if (distance(coords[2 * i], coords[2 * i + 1], x, y) <= square) out[count++] = ids[i]; }
    return count;
  }
  nearest(x: any, y: any) {
    const coords = this.coords;
    let best = -1, least = Infinity;
    for (let i = 0; i < coords.length / 2; i++) { const d = distance(coords[2 * i], coords[2 * i + 1], x, y); if (d < least) { least = d; best = i; } }
    return best;
  }
  change(x: any, y: any, next: any) {
    const coords = this.coords;
    let sum = 0;
    for (let i = 0; i < coords.length / 2; i++) { coords[2 * i] = distance(coords[2 * i], coords[2 * i + 1], x, y) % 50; sum += coords[2 * i]; if (i === 7) x = next; }
    return sum;
  }
}
const coords = new Float64Array(200); for (let i = 0; i < 200; i++) coords[i] = (i * 37 % 101) / 2;
const points = unknown(new Points(coords)), log: string[] = [];
function call(name: string, ...args: any[]) { try { return points[name](...args); } catch (error: any) { return error.constructor.name + ": " + log.splice(0).join(); } }
const found = new Uint16Array(100); let total = 0;
for (let t = 0; t < 300; t++) { total = total * 31 + points.within(t % 50, t % 37 + 0.5, 9, found) + found[t % 5] | 0; total = total * 31 + points.nearest(t % 43, t / 7) | 0; }
console.log(total);
const strange: any[] = [undefined, null, true, "12", "x", NaN, -0, Infinity, 2 ** 40, 7.25, { valueOf() { log.push("v"); return 9; } }, { valueOf() { if (log.push("w") === 3) throw new RangeError("third"); return log.length; } }, Symbol("s"), 5n, [4], new Date(8), function () { }];
for (const x of strange) for (const y of [3, x, strange[10]]) {
  const out: any[] = [];
  console.log(String(call("within", x, y, 12, out)), out.join(), String(call("nearest", x, y)), log.splice(0).length);
  coords.forEach((_, i) => coords[i] = (i * 37 % 101) / 2);
  console.log(String(call("change", 3, y, x)), coords.slice(0, 30).join(), log.splice(0).length);
  coords.forEach((_, i) => coords[i] = (i * 37 % 101) / 2);
}
const empty = unknown(new Points(new Float64Array(0)));
console.log(empty.within(Symbol("s"), 5n, 3, []), empty.nearest({ valueOf() { throw new Error("never"); } }, 1n));
