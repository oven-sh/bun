// A typed literal fills three fields and then spreads an object that the same literal made, in which text evaluated at run time has stored undefined and null.
type P = { x: number; y: number; on: boolean };
const poke = new Function("o", "o.x = undefined; o.on = null;") as (o: object) => void;
const look = new Function("o", "return typeof o.x + ' ' + String(o.on);") as (o: object) => string;
function layer(p: Partial<P> | null, i: number): P { return { x: i + 0.5, y: i, on: true, ...p }; }
function read(p: P): string { return String(p.x) + "," + (p.x + p.y) + "," + String(p.on) + "," + (p.on ? "yes" : "no"); }
const out: string[] = [];
for (let i = 0; i < 8; i++) {
  const inner = layer(null, i);
  if (i >= 4) poke(inner);
  const outer = layer(inner, 100 + i);
  out.push(read(outer) + " | " + look(outer));
}
console.log(out.join("\n"));
