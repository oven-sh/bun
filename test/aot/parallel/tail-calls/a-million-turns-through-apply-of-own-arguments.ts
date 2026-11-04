// a ring of tail calls goes through f.apply(this, arguments) a million times
let left = 0;
function work(this: unknown, a: number, b: number): number {
  if (left-- === 0) return a * 3 + b;
  return wrap(b, (a + 1) & 7);
}
function wrap(this: unknown, a: number, b: number): number {
  return work.apply(this, arguments as any);
}
function deed(turns: number) {
  left = turns;
  return String(wrap(1, 2));
}
console.log(deed(3));
for (let i = 0; i < 5; i++) console.log(deed(1000 + i));
console.log(deed(1000000));
