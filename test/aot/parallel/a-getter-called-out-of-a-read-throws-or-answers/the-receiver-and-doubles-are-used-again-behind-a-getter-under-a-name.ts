const above: any = {};
let seed = 0.5;
function churn(): number {
  const a = seed * 1.5, b = seed * 2.5, c = seed * 3.5, d = seed * 4.5, e = seed * 5.5, f = seed * 6.5, g = seed * 7.5, h = seed * 8.5;
  const i = a / 3, j = b / 5, k = c / 7, l = d / 9, m = e / 11, n = f / 13, o = g / 15, p = h / 17;
  seed = (a + b + c + d + e + f + g + h + i + j + k + l + m + n + o + p) % 7;
  return seed;
}
Object.defineProperty(above, "ripe", { get() { return churn(); }, configurable: true });
Object.defineProperty(above, "riper", { get() { return churn() * 2; }, configurable: true });
const orchard: any = Object.create(above);
orchard.rows = 3;
function reads(at: any, part: number, other: number): number {
  const b = part * 0.5 + 0.25, d = other / 3;
  const x = at.ripe;
  const y = at.riper;
  const z = at.rows;
  return x + y + z + b + d;
}
const turns = JSON.parse("5");
for (let t = 0; t < turns; t++) console.log(reads(orchard, t + 0.5, t + 0.25).toFixed(6));
