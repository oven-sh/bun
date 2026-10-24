// Text evaluated at run time stores undefined and null over a number and a boolean of a typed record. Object.assign carries them onto a copy by spread of a record of the same type.
type P = { x: number; y: number; on: boolean };
const poke = new Function("o", "o.x = undefined; o.on = null;") as (o: object) => void;
const look = new Function("o", "return typeof o.x + ' ' + String(o.on);") as (o: object) => string;
function make(i: number): P { return { x: i + 0.5, y: i * 2, on: true }; }
function merge(a: P, b: P): P { const c = { ...a }; Object.assign(c, b); return c; }
function read(p: P): string { return String(p.x) + "," + (p.x + p.y) + "," + String(p.on) + "," + (p.on ? "yes" : "no"); }
const out: string[] = [];
for (let i = 0; i < 8; i++) {
  const source = make(i);
  if (i >= 4) poke(source);
  const merged = merge(make(100 + i), source);
  out.push(read(merged) + " | " + look(merged));
}
console.log(out.join("\n"));
