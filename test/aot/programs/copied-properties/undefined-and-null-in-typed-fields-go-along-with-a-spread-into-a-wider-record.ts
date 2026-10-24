// Text evaluated at run time stores undefined and null over a number and a boolean of a typed record. A spread carries them into a record with one more field, in front of it and behind it.
type A = { n: number; flag: boolean; s: string };
type B = { extra: number; n: number; flag: boolean; s: string };
const poke = new Function("o", "o.n = undefined; o.flag = null;") as (o: object) => void;
const look = new Function("o", "return typeof o.n + ' ' + String(o.flag);") as (o: object) => string;
function makeA(i: number): A { return { n: i + 0.5, flag: (i & 1) === 0, s: "a" + i }; }
function widen(a: A, i: number): B { return { extra: i, ...a }; }
function widenLate(a: A, i: number): B { const b = { ...a, extra: i }; return b; }
function read(b: B): string { return String(b.n) + "," + String(b.flag) + "," + (b.n + 1) + "," + (b.flag ? "yes" : "no"); }
const out: string[] = [];
for (let i = 0; i < 6; i++) {
  const a = makeA(i);
  if (i >= 3) poke(a);
  const b = widen(a, i), c = widenLate(a, i);
  out.push(read(b) + " | " + look(b) + " | " + read(c) + " | " + look(c));
}
console.log(out.join("\n"));
