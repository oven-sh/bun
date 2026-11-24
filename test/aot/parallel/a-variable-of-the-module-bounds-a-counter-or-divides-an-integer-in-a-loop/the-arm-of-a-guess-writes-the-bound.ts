class P { x: number; constructor(x: number) { this.x = x; } }
let bound = 0, next = 0, last = 0;
const odd = new Proxy({ x: 1 }, { get(): number { bound = next; return 1; } });
const marks = new Int32Array(8);
const list: P[] = [];
list.push(new P(1)); list.push(odd as any);
function a(first: any, second: any): number {
  const both: P[] = [first, second]; let hits = 0;
  for (let i = 0; i < bound; i++) { marks[i & 7] = i; if (both[i & 1].x === 1) hits++; }
  return hits;
}
function b(first: any, second: any): number {
  const both: P[] = [first, second]; let hits = 0;
  for (let i = 0; i < bound; i++) { last = i; if (both[i & 1].x === 1) hits++; }
  return hits;
}
function c(): number {
  let hits = 0;
  for (let i = 0; i < bound; i++) { marks[i & 7] = i; if (list[i & 1].x === 1) hits++; }
  return hits;
}
function control(first: any, second: any): number {
  const both: P[] = [first, second]; let hits = 0;
  for (let i = 0; i < bound; i++) { if (both[i & 1].x === 1) hits++; }
  return hits;
}
bound = 2.5; a(new P(1), new P(1)); b(new P(1), new P(1)); control(new P(1), new P(1));
for (const n of [5, 3.5, 0, NaN, 20]) {
  next = n; const out: number[] = [];
  bound = 12; out.push(a(new P(1), odd)); bound = 12; out.push(b(new P(1), odd));
  bound = 12; out.push(c()); bound = 12; out.push(control(new P(1), odd));
  console.log(n, out.join(" "), bound, last);
}
