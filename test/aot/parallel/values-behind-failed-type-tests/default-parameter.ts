const kept: unknown[] = [];
class Point {
  constructor(public x = 0, public y = 0) {}
}
function keep(value: number | undefined = 7) {
  kept.push(value);
}
keep();
keep(undefined);
keep(2.5);
keep(null as any);
keep("text" as any);
keep({ a: 1 } as any);
const points = [new Point(), new Point(1), new Point(undefined, 2.5), new Point(null as any, "y" as any)];
for (const point of points) console.log(point.x, point.y, typeof point.x, typeof point.y);
console.log(JSON.stringify(kept));
