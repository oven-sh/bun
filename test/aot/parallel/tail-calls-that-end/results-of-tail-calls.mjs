// A strict function that ends in a call holds the type of its result where the call ends. An abstract method that throws gives its caller nothing.
class Info {
  constructor(shape) {
    this.shape = shape;
    this.distance = null;
    this.isHit = false;
  }
  limit() {
    this.distance = this.distance > 100 ? 100 : this.distance;
    return this;
  }
}
class Shape {
  intersect(n) {
    throw new Error("abstract " + n);
  }
  nearest(n) {
    return this.intersect(n);
  }
}
class Ball extends Shape {
  intersect(n) {
    const info = new Info(this);
    info.isHit = n % 2 === 0;
    info.distance = n * 40;
    return info.limit();
  }
}
class Plane extends Shape {
  intersect(n) {
    if (n > 2) return this.far(n);
    return new Info(this);
  }
  far(n) {
    const info = new Info(this);
    info.isHit = true;
    info.distance = -n;
    return info.limit();
  }
}
const shapes = [new Ball(), new Plane(), new Ball()];
function best(n, all) {
  let found = null;
  for (let i = 0; i < all.length; i++) {
    const info = all[i].nearest(n);
    if (info.isHit && (found === null || info.distance < found.distance)) found = info;
  }
  return found;
}
for (let n = 0; n < 6; n++) {
  const found = best(n, shapes);
  console.log(found === null ? "none" : found.distance + " " + found.shape.constructor.name);
}
try {
  console.log(best(1, [...shapes, new Shape()]));
} catch (error) {
  console.log(error.message);
}
// So many calls need jumps.
function even(n) {
  if (n === 0) return new Info("even");
  return odd(n - 1);
}
function odd(n) {
  if (n === 0) return new Info("odd");
  return even(n - 1);
}
class Link {
  constructor(next) {
    this.next = next;
  }
  last(n) {
    return this.next === null ? new Info(n) : this.next.last(n + 1);
  }
}
let links = null;
for (let i = 0; i < 100000; i++) links = new Link(links);
console.log(even(100000).shape, odd(100000).shape, links.last(0).shape);
Ball.prototype.intersect = function (n) {
  return { isHit: true, distance: "replaced " + n, shape: { constructor: { name: "none" } } };
};
for (let n = 0; n < 2; n++) console.log(best(n, shapes).distance);
Shape.prototype.intersect = function (n) {
  return n;
};
console.log(new Shape().nearest(7), best(3, [new Shape()]));
