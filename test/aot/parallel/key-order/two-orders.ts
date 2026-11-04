// Two literals of one type list the same keys in two orders.
type Point = { x: number; y: number };
function twice(n: number) {
  return n * 2;
}
function first(n: number): Point {
  return { x: n, y: twice(n) };
}
function second(n: number): Point {
  return { y: twice(n), x: n };
}
function keys(point: Point) {
  return Object.keys(point).join();
}
console.log(keys(first(1)), keys(second(1)));
