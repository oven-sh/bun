// A function returns the fields of a fresh object. Its constructor stores a value of another type than the declared one.
class Point {
  x: string;
  y: any;
  constructor(x: any, y: any) {
    this.x = x;
    this.y = y;
  }
}
function make(i: number) {
  let work = 0;
  for (let t = 0; t < i; t++) work += t;
  if (i === 0) return new Point(NaN, 1);
  if (i === 1) return new Point("text", work);
  return new Point([i], work);
}
for (let i = 0; i < 4; i++) {
  const point: any = make(i);
  console.log(String(point.x), point.y);
}
