const above: any = {};
let calls = 0;
Object.defineProperty(above, "ripe", { get() { calls++; if (calls % 3 === 0) throw new RangeError("third"); return calls; }, configurable: true });
const orchard: any = Object.create(above);
function look(at: any, whole: number, part: number): string {
  const a = whole * 3 + 1, b = part * 0.5 + 0.25, c = whole ^ 21, d = part / 3;
  let seen: unknown;
  try { seen = at.ripe; } catch (error: any) { seen = error.constructor.name + ":" + error.message; }
  return [seen, a, b, c, d].join(" ");
}
const turns = JSON.parse("7");
for (let t = 0; t < turns; t++) console.log(look(orchard, t, t + 0.5));
