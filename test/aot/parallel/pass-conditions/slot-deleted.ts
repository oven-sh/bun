// Alone: how a field is held goes by all that the executable does to objects of its class
// STATISTIC: SlotsWithAbsentState >= 1
class P {
  x = 3;
  y = 4;
}
function use(p: P): number {
  return p.x + p.y;
}
let out = "";
for (let i = 0; i < 120; i++) {
  const p = new P();
  use(p);
  if (i === 60) delete (p as any).x;
  if (i >= 59 && i <= 61) out += use(p) + ";";
}
console.log(out);
