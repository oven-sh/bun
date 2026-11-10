// STATISTIC: AccessesDispatchedByKeyString >= 3
const said: unknown[] = [];
class Point { x = 1; y = 2; z = 3; }
function read(p: Point, k: "x" | "y") { return p[k]; }
const p = new Point(); let sum = 0;
for (let i = 0; i < 400; i++) {
  sum += read(p, i & 1 ? "x" : "y");
  let k: "x" | "y" | "z" = "x"; if (i & 1) k = "y"; else if (i & 2) k = "z"; sum += i & 4; sum += p[k];
  const side = i & 8 ? "x" : "z"; if (i & 16) sum += 1; p[side] = (i & 3) + 1; sum += p[side];
}
said.push(sum, p.x, p.y, p.z);
console.log(said.map(String).join(" "));
