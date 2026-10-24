// Text evaluated at run time stores undefined over a number and a boolean of a typed record. Copies by spread hold what the source holds.
type P = { x: number; y: number; on: boolean };
const poke = new Function("o", "o.x = undefined; o.on = undefined;") as (o: object) => void;
const look = new Function("o", "return typeof o.x + ' ' + typeof o.on;") as (o: object) => string;
function make(i: number): P { return { x: i, y: i * 2, on: true }; }
function copy(p: P): P { return { ...p }; }
function over(p: P, q: P): P { return { ...p, ...q }; }
function read(p: P): string { return String(p.x) + "," + (p.x + p.y) + "," + String(p.on); }
const out: string[] = [];
for (let i = 0; i < 6; i++) {
  const p = make(i);
  if (i >= 3) poke(p);
  const c = copy(p), o = over(make(9), p);
  out.push(read(c) + " | " + look(c) + " | " + read(o) + " | " + look(o));
}
console.log(out.join("\n"));
