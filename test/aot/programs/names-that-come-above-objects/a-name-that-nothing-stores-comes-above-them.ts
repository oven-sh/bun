// The objects declare a field that nothing ever stores. Its name comes above them by a store, a getter, another prototype and evaluated text, one after the other.
interface Options {
  a: number;
  never?: number;
}
class Point {
  a: number;
  declare never?: number;
  constructor(a: number) {
    this.a = a;
  }
}
const options: Options[] = [];
const points: Point[] = [];
for (let a = 0; a < 8; a++) {
  options.push({ a });
  points.push(new Point(a));
}
function readOptions(): string {
  let text = "";
  for (const object of options) text += `${object.never}${"never" in object ? "+" : "-"}`;
  return text;
}
function readPoints(): string {
  let text = "";
  for (const object of points) text += `${object.never}${"never" in object ? "+" : "-"}`;
  return text;
}
function round(label: string) {
  console.log(label, readOptions(), readPoints());
}

round("before");
(Point.prototype as any).never = "text";
round("a store");
delete (Point.prototype as any).never;
Object.defineProperty(Point.prototype, "never", { get: () => 7, configurable: true });
round("a getter");
delete (Point.prototype as any).never;
round("deleted");
Object.setPrototypeOf(options[1], { never: null });
Object.setPrototypeOf(points[1], { never: [1] });
round("another prototype");
new Function("object", "Object.getPrototypeOf(object).never = 'from text'")(points[2]);
round("evaluated text");
