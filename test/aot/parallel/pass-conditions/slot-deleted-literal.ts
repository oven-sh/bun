// Alone: how a field is held goes by all that the executable does to objects of its class
// STATISTIC: SlotsWithAbsentState >= 1
type R = { x?: number; y: number };
function use(p: R): string {
  return (p.x ?? 10) + p.y + ":" + Object.keys(p).join();
}
let out = "";
for (let i = 0; i < 120; i++) {
  const p: R = { x: 3, y: 4 };
  use(p);
  if (i === 60) delete p.x;
  if (i >= 59 && i <= 61) out += use(p) + ";";
}
console.log(out);
