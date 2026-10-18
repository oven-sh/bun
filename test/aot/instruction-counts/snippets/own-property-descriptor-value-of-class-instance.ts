// takes the value and a flag out of the own property descriptors of an instance of a class, name by name
class Point {
  x: number;
  y: number;
  label: string;
  next: Point | undefined = undefined;
  constructor(x: number, y: number, label: string) {
    this.x = x;
    this.y = y;
    this.label = label;
  }
}
const operations = 100;
const names = ["x", "y", "label", "next"];
const points: object[] = [];
for (let i = 0; i < operations / 4; i++) points.push(new Point(i, i / 2, "p" + i));
let total = 0;

kernel: {
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    for (let j = 0; j < names.length; j++) {
      const { value, writable } = Object.getOwnPropertyDescriptor(point, names[j])!;
      if (writable && value !== undefined) total++;
    }
  }
}

console.log(total);
