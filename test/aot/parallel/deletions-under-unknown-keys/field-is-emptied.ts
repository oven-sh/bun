const keyOfX: string = JSON.parse('"x"');
const keyOfExtra: string = JSON.parse('"extra"');
const keyOfZero: string = JSON.parse('"0"');
const turns: number = JSON.parse("3");
class Point {
  x = 1;
  y = 2;
}
function sum(point: Point) {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += (point.x ?? 100) + point.y;
  return total;
}
function empty(point: Point, key: string) {
  delete (point as any)[key];
}
const kept = new Point();
const emptied = new Point();
console.log(sum(kept), sum(emptied));
empty(emptied, keyOfX);
console.log(sum(kept), sum(emptied), "x" in emptied, "x" in kept, Object.keys(emptied).join(), emptied.x, typeof emptied.x);
