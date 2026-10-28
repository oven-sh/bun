// A union of a class and `object` takes a map, an error, a list and a function
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
function tell(v: Point | object): string {
  return (
    (v instanceof Point) +
    "|" +
    (v instanceof Map) +
    "|" +
    (v instanceof Error) +
    "|" +
    Array.isArray(v) +
    "|" +
    Object.keys(v).join()
  );
}
const list: (Point | object)[] = [new Point(1, 2), new Map([[1, 2]]), new Error("e"), [1, 2], { x: 3 }, () => 1];
for (let round = 0; round < 3; round++) for (const v of list) console.log(tell(v));
