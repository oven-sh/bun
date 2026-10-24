// The objects declare a field that nothing ever stores, and nothing ever comes above them under its name.
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
let text = "";
for (const object of options) text += `${object.never}${"never" in object ? "+" : "-"}${Object.hasOwn(object, "never")}`;
for (const object of points) text += `${object.never}${"never" in object ? "+" : "-"}${Object.hasOwn(object, "never")}`;
console.log(text);
