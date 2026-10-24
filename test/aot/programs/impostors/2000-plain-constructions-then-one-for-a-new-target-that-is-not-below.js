class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
class WithFields {
  a = 1;
  b = "two";
  c = [3];
}
class Other {
  first = "first of Other";
  second = "second of Other";
  third = "third of Other";
  sum() {
    return "the sum of Other";
  }
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += new Point(i, 1).sum();
  total += new WithFields().a;
}
console.log("total", total);

const targets = [Point, Other, Point, WithFields, Other];
for (const target of targets) {
  const p = Reflect.construct(Point, [10, 20], target);
  console.log("Point for", target.name + ":", Object.keys(p).join(), p.x, p.y, p.first, p.a, typeof p.sum === "function" ? p.sum() : "no sum", Object.getPrototypeOf(p) === target.prototype);
  const w = Reflect.construct(WithFields, [], target);
  console.log("WithFields for", target.name + ":", Object.keys(w).join(), w.a, w.b, w.c.length, w.first, w.x, Object.getPrototypeOf(w) === target.prototype);
}

const real = new Other();
console.log("a real Other:", Object.keys(real).join(), real.first, real.second, real.third, real.x);
for (let i = 0; i < 2000; i++) total += new Point(i, 1).sum();
console.log("total", total);
