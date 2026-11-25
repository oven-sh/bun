class Point { constructor(x) { this.x = x; this.tag = "p"; } len() { return this.x * 2; } get twice() { return this.x * 2; } }
class Other { constructor(x) { this.x = x; this.more = 1; } len() { return this.x * 3; } }
const lines = [];
const show = point => lines.push(typeof point.x + " " + point.x + " " + point.len() + " " + point.twice + " " + Object.keys(point).join());
const name = text => JSON.parse(JSON.stringify(text));
const first = new Point(1);
const values = [first, new Map([[1, 2]]), new Other(2), new Point(3)];
Object.defineProperty(Map.prototype, name("zz"), { set(value) { for (const each of values) if (each instanceof Point) each.x = "changed" + value; }, configurable: true });
let sum = 0;
for (let i = 0; i < values.length; i++) { const v = values[i]; v.zz = i; }
lines.push("sum " + sum);
const own = new Point(4); show(own); show(first);
console.log(lines.join("\n"));
