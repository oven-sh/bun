class Point {
  x = 1.5;
  label = "here";
}
const point = new Point();
for (const key of Object.keys(point)) console.log(key.length, typeof point[key], point[key]);
