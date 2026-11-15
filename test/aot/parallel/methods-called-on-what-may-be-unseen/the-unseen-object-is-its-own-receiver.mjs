class Point { constructor(x) { this.x = x; this.seen = 0; } touch(n) { this.seen++; return this.x + n; } take(c) { return c.y; } get twice() { return this.x * 2; } }
class Carried { constructor(y) { this.y = y; } }
const texts = ['{"x": 40}', '{"x": "t", "touch": 1}', '[1, 2]', '{"twice": 9}'];
const made = texts.map(t => JSON.parse(t));
made[0].touch = function (n) { this.x += n; return this.x; };
made[0].take = function (c) { c.y = "changed"; return 7; };
made[2].touch = Point.prototype.touch;
made[3].touch = n => n * 3;
const borrowed = { x: 1000, seen: 0, touch: Point.prototype.touch };
function poke(p, n) { try { return p.touch(n); } catch (e) { return e.constructor.name; } }
function give(p, c) { try { return p.take(c); } catch (e) { return e.constructor.name; } }
function twice(p) { return p.twice; }
const points = [new Point(2), new Point(3.5)], carried = new Carried(5), out = [];
for (let r = 0; r < 3; r++) for (const p of [points[0], made[0], points[1], made[1], made[2], made[3], borrowed, new Proxy(points[0], {}), Object.create(points[1])]) out.push(poke(p, r));
out.push(give(points[0], carried), carried.y, give(made[0], carried), carried.y, give(made[1], carried));
out.push(points[0].x, points[0].seen, points[1].x, points[1].seen, made[0].x, made[2].x, made[2].seen, borrowed.seen, twice(points[0]), twice(made[3]), twice(made[1]));
console.log(out.join(" "));
