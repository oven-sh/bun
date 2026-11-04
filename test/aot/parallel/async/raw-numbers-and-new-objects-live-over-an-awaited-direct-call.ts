// Raw numbers, an object that is just made and the answer of a test are alive over an awaited direct call, and the collector runs while the caller waits.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
async function load(x: number) {
  await null;
  Bun.gc(true);
  await null;
  return x + 0.5;
}
async function run(n: number, text: unknown) {
  const half = n / 2;
  const whole = (n * 3) | 0;
  const point = new Point(half, whole);
  const isText = typeof text === "string";
  const given = await load(half);
  Bun.gc(true);
  return [half, whole, point.x, point.y, isText ? (text as string).length : -1, given].join();
}
function deed(n: number, text: unknown) {
  return run(n, text);
}
console.log(await deed(3, "abc"));
console.log(await deed(4, 5));
for (let i = 0; i < 5; i++) console.log(await deed(i, i % 2 ? "x".repeat(i) : null));
