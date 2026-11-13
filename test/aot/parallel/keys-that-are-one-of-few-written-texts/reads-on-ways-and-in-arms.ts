// STATISTIC: JoinsDuplicatedPerKeyString >= 1
const said: unknown[] = [];
class Point { x = 1; y = 2; z = 3; get w() { said.push("w is read"); return 4; } }
class Bare { x = "only x"; }
function read(p: Point, k: "x" | "y") { return p[k]; }
function readOfThree(p: Point, k: "x" | "y" | "z") { return p[k]; }
function readOfFour(p: Point, k: "x" | "y" | "z" | "w") { return p[k]; }
const p = new Point(); const below = Object.create(p) as Point; below.y = 20;
const bare = new Bare() as unknown as Point;
let sum = 0;
for (let i = 0; i < 400; i++) {
  sum += p[i & 1 ? "x" : "y"];
  sum += read(p, i & 1 ? "x" : "y") + read(below, i & 2 ? "x" : "y");
  sum += readOfThree(p, i % 3 === 0 ? "x" : i % 3 === 1 ? "y" : "z");
  if (i < 8) { said.push(readOfFour(p, (["x", "y", "z", "w"] as const)[i & 3]), read(bare, i & 1 ? "x" : "y")); }
  let k: "x" | "y" | "z" = "x"; if (i & 1) k = "y"; else if (i & 2) k = "z"; sum += p[k];
}
said.push(sum);
console.log(said.map(String).join(" "));
