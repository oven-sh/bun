class O { l: number[] = []; }
const o = new O();
function f(t: number): string {
  let s = 0;
  for (let i = 0; i < 100; i++) { s += (o.l[i] || 0) * t; }
  return s + ":" + o.l[50] + ":" + o.l[99] + ":" + o.l.length;
}
function g(t: number): string {
  let s = 0;
  for (let i = 0; i < 100; i++) { s += (o.l[i] || 0) * t; }
  let r = 0;
  for (let i = 0; i < 100; i++) { r += o.l[i] === undefined ? 1 : 0; }
  return s + ":" + r + ":" + o.l[50] + ":" + o.l[99] + ":" + o.l.length;
}
function grow(to: number): void { while (o.l.length < to) o.l.push(o.l.length + 0.5); }
function shrink(to: number): void { while (o.l.length > to) o.l.pop(); }
console.log(0, f(1), f(2), g(1), g(3));
for (const n of [3, 50, 51, 99, 100, 101, 120]) { grow(n); console.log(n, f(1), f(2), g(1), g(3)); }
for (const n of [100, 99, 51, 50, 3, 0]) { shrink(n); console.log(n, f(1), f(2), g(1), g(3)); }
grow(120); console.log(120, f(1), g(1));
