// STATISTIC: AccessesDispatchedByKeyString >= 1
const said: unknown[] = [];
class Point { x = 1; y = 2; z = 3; }
class Pair { x = 0; y = 0; }
let sum = 0; const kept: Pair[] = [];
for (let i = 0; i < 300; i++) {
  const k = i & 1 ? "x" : "y";
  const made = new Pair(); made[k] = i;
  if (i & 2) sum += 100;
  const p = new Point(); p.x = i; p.y = -i;
  sum += p[k];
  if (i & 4) sum += 1;
  const q = new Point(); q[k] = 7; q.z = i;
  sum += q.x * 3 + q.y * 5 + q[k] + made.x - made.y + made[k];
  if (i % 100 === 0) kept.push(made);
}
for (let i = 0; i < 300; i++) {
  const p = new Point(), q = new Pair();
  q[i & 1 ? "x" : "y"] = p[i & 2 ? "x" : "y"] + i; sum += q.x - q.y;
}
said.push(sum, JSON.stringify(kept));
console.log(said.map(String).join(" "));
