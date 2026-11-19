const said: unknown[] = [];
class Point { x = 1; y = 2; }
function narrowed(p: Point, k: string) { if (k === "x" || k === "y") return p[k]; return -1; }
function read(p: Point, k: "x" | "y") { return p[k]; }
const p = new Point(); let sum = 0;
const made = [String.fromCharCode(120), String.fromCharCode(121), "xy".slice(0, 1), "xy".slice(1), ["x"].join(""), "z", "", "xx"];
const others: unknown[] = [null, undefined, 5, "text", [7, 8], { x: "a record's x" }, new Proxy({ x: 1, y: 2 }, { get(_, name) { return "asked for " + String(name); } }), Object.create(null), () => 1];
for (let i = 0; i < 300; i++) {
  sum += narrowed(p, made[i & 7]);
  sum += read(p, made[i & 1] as "x" | "y");
  if (i < others.length * 2) { try { said.push(read(others[i >> 1] as Point, i & 1 ? "x" : "y")); } catch (e) { said.push((e as Error).constructor.name); } }
}
said.push(sum);
console.log(said.map(String).join(" "));
