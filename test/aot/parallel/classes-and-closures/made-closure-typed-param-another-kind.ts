// Functions that run once hand a closure over a typed parameter to a built-in, to another function or call it themselves, and use what comes back. Each gets a value of another kind than its parameter says.
// Flags: --aot-check=verify-each-pass
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum() {
    return this.x + this.y;
  }
}
const parsed = (text: string): any => JSON.parse(text);
const call = <T>(make: () => T): T[] => [make(), make()];

function mapped(count: number) {
  const list = [1, 2, 3].map(() => count);
  return [typeof list[0], list[0] + 1, list];
}
function added(count: number) {
  const list = [1, 2, 3].map(item => item + count);
  let sum = 0;
  for (const item of list) sum += item;
  return [sum, typeof list[0]];
}
function reduced(count: number) {
  const last = [1, 2].reduce((held, item) => count, 0);
  return [typeof last, last + 1];
}
function made(count: number) {
  const make = () => [count, count];
  const list = make();
  return [typeof list[0], list[0] + 1, list.length];
}
function boxed(count: number) {
  const make = () => ({ held: count });
  const box = make();
  return [typeof box.held, box.held + 1];
}
function handedOn(count: number) {
  const list = call(() => count);
  return [typeof list[0], list[0] + 1, list];
}
function literal(flag: true) {
  const list = [0, 0].map(() => flag);
  return [list[0] ? "yes" : "no", list[0] === true, list];
}
function oneOfTwo(index: 1 | 2) {
  const list = [0, 0].map(() => index);
  return [["zero", "one", "two"][list[0]], list[0] === 1 || list[0] === 2, list];
}
function points(point: Point) {
  const list = [1, 2].map(() => point);
  return [list[0].x, list[1].y, typeof list[0].sum];
}
function stored(point: Point) {
  let held = point;
  const list = [1, 2].map(() => {
    const before = held;
    held = point;
    return before;
  });
  return [list[0].x, list[1].y, held.x];
}
async function awaited(count: number) {
  const value = await new Promise<number>(resolve => resolve(count));
  return [typeof value, value + 1];
}
function later(count: number) {
  return new Promise<number>(resolve => Promise.resolve(count).then(() => resolve(count)));
}

console.log(new Point(1, 2).sum());
console.log(mapped(parsed('"a"')));
console.log(added(parsed('"a"')));
console.log(reduced(parsed('"a"')));
console.log(made(parsed('"a"')));
console.log(boxed(parsed('"a"')));
console.log(handedOn(parsed('"a"')));
console.log(literal(parsed("false")));
console.log(oneOfTwo(parsed("7")));
console.log(points(parsed('{"z": 9, "y": 5, "x": 7}')));
console.log(stored(parsed('{"z": 9, "y": 5, "x": 7}')));
console.log(await awaited(parsed('"text"')));
const value = await later(parsed('"text"'));
console.log(typeof value, value + 1);
