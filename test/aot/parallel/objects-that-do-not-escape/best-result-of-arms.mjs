// A loop calls a method of several classes, takes its result apart and keeps the best one.
const seen = [];
class Vector {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  add(o) {
    return new Vector(this.x + o.x, this.y + o.y);
  }
  scale(f) {
    return new Vector(this.x * f, this.y * f);
  }
  dot(o) {
    return this.x * o.x + this.y * o.y;
  }
}
class Info {
  constructor() {
    this.hit = false;
    this.count = 0;
    this.shape = null;
    this.position = null;
    this.color = Info.none;
    this.distance = null;
  }
}
Info.none = new Vector(0, 0);
class Shape {
  constructor(at) {
    this.at = at;
  }
  meet(ray) {
    throw new Error("abstract");
  }
}
class Ball extends Shape {
  constructor(at, size) {
    super(at);
    this.size = size;
  }
  meet(ray) {
    const info = new Info();
    info.shape = this;
    const b = this.at.dot(ray.direction);
    const d = b * b - this.at.dot(this.at) + this.size * this.size;
    if (d > 0) {
      info.hit = true;
      info.distance = b - Math.sqrt(d);
      info.position = ray.position.add(ray.direction.scale(info.distance));
      info.color = this.at;
    } else {
      info.hit = false;
    }
    return info;
  }
}
class Wall extends Shape {
  constructor(at, d) {
    super(at);
    this.d = d;
  }
  meet(ray) {
    const info = new Info();
    info.shape = this;
    const v = this.at.dot(ray.direction);
    if (v === 0) return info;
    const t = -(this.at.dot(ray.position) + this.d) / v;
    if (t <= 0) return info;
    info.hit = true;
    info.position = ray.position.add(ray.direction.scale(t));
    info.distance = t;
    if (t > 1e6) seen.push(info);
    return info;
  }
}
function closest(shapes, ray, except) {
  let count = 0;
  let best = new Info();
  best.distance = 2000;
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (shape !== except) {
      const info = shape.meet(ray);
      if (info.hit && info.distance >= 0 && info.distance < best.distance) {
        best = info;
        count++;
      }
    }
  }
  best.count = count;
  return best;
}
function all(shapes, ray) {
  const found = [];
  for (const shape of shapes) {
    const info = shape.meet(ray);
    if (info.hit) found.push(info);
    else if (info.position !== null) found.push(null);
  }
  return found;
}
const show = info => `${info.hit} ${info.count} ${info.shape && info.shape.constructor.name} ${info.position && info.position.x.toFixed(6)} ${info.color === Info.none} ${info.distance}`;
const shapes = [new Ball(new Vector(3, 1), 1.5), new Wall(new Vector(-1, 0), 9), new Ball(new Vector(4, -1), 2), new Wall(new Vector(0, 1), 0.5)];
for (let i = 0; i < 12; i++) {
  const ray = { position: new Vector(0, i - 4), direction: new Vector(Math.cos(i), Math.sin(i)) };
  const first = closest(shapes, ray, null);
  const second = closest(shapes, ray, first.shape);
  console.log(i, show(first), "|", show(second), "|", all(shapes, ray).map(info => info.distance).join(), first === second, first.position === second.position);
  if (i === 8) {
    Ball.prototype.meet = function (ray) {
      const info = new Info();
      info.hit = true;
      info.distance = 0.5;
      info.shape = this;
      seen.push(info);
      return info;
    };
  }
  if (i === 10) shapes.push({ meet: () => ({ hit: true, distance: 0.25, count: 7, shape: null, position: null, color: null }) });
}
console.log(seen.length, seen.map(show).join("; "));
try {
  closest([shapes[1], new Shape(Info.none)], { position: Info.none, direction: new Vector(1, 0) }, null);
} catch (problem) {
  console.log(problem.message);
}
