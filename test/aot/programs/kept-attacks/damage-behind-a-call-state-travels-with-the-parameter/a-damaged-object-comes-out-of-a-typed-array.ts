// Some objects in a typed array were damaged long ago. A typed function takes each out and passes it to another typed function, whose typed body assumes that the fields lie in their slots.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const points: Point[] = [];
for (let index = 0; index < 40; index++) points.push(new Point(index, 1));
delete (points[7] as any).x;
Object.defineProperty(points[17], "x", { get: () => -7 });
(points[27] as any).x = "text";
Object.setPrototypeOf(points[37], null);

function sum(p: Point): string {
  return "" + (p.x + p.y);
}

function walk(list: Point[]): string {
  let text = "";
  for (let index = 0; index < list.length; index++) {
    const p = list[index];
    text += sum(p) + "/" + p.x + " ";
  }
  return text;
}

let last = "";
for (let round = 0; round < 50; round++) last = walk(points);
console.log(last);
