// Allocations that the compiler removes.
function assertNotAllocated(_: unknown): void {}
function literal(a: number, b: number): number {
  const p = { a, b }; //! removed
  assertNotAllocated(p);
  return p.a + p.b;
}
function pattern(a: number, b: number): number {
  const t = [a, b]; //! removed
  assertNotAllocated(t);
  const [x, y] = t;
  return x - y;
}
function callback(list: number[]): number { //! heap: NewClosure
  let s = 0;
  const add = (x: number) => { s += x; }; //! built at 1 place: CallBuiltin
  assertNotAllocated(add);
  list.forEach(add);
  return s;
}
function sum(...rest: number[]): number {
  assertNotAllocated(rest);
  return rest.length === 2 ? rest[0] + rest[1] : 0;
}
const kept: number[][] = [];
function late(a: number, bad: boolean): number {
  const t = [a, a + 1]; //! built at 1 place: CallBuiltin
  assertNotAllocated(t);
  if (bad) kept.push(t);
  return a;
}
let n = 0;
const list = [1, 2, 3];
for (let i = 0; i < 4; i++) n += literal(i, 1) + pattern(i, 2) + callback(list) + sum(i, 3) + late(i, i === 2); //! removed
console.log(n, kept.length, kept[0][0], kept[0][1]);
