// `Object.assign(settings, overlay)` with an overlay nobody knows: the names go into `settings` alone. Other objects, also those that code nobody sees has been given, keep what is known of them.
const settings = { depth: 2, width: 3 };
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
const points = [];
for (let i = 0; i < 64; i++) points.push(new Point(i, i * 2));
JSON.stringify(points, (key, value) => value);
Object.assign(settings, JSON.parse('{"width":5,"extra":"yes"}'));
let total = 0;
for (let round = 0; round < 100000; round++) for (let i = 0; i < points.length; i++) total += points[i].x + points[i].y;
console.log(total, settings.depth, settings.width, settings.extra, Object.keys(settings).join());
