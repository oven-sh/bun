class Stamper extends function (target) {
  return target;
} {
  #mark = 1;
  static has(target) {
    return #mark in target;
  }
  static read(target) {
    return target.#mark;
  }
  static raise(target) {
    return ++target.#mark;
  }
}

class Point {
  x = 1;
  y = 2;
  sum() {
    return this.x + this.y;
  }
}

const plain = new Point();
const stamped = new Point();
console.log("before", Stamper.has(plain), Stamper.has(stamped));
new Stamper(stamped);
console.log("after", Stamper.has(plain), Stamper.has(stamped), Stamper.read(stamped), Stamper.raise(stamped));
console.log("keys", Object.keys(stamped).join(), Object.getOwnPropertyNames(stamped).join(), JSON.stringify(stamped));
console.log("copy", JSON.stringify({ ...stamped }), Stamper.has({ ...stamped }), Stamper.has(Object.assign(new Point(), stamped)));
stamped.z = 3;
console.log("one more member", Object.keys(stamped).join(), stamped.sum(), stamped.z, Stamper.read(stamped));
delete stamped.x;
console.log("one member less", Object.keys(stamped).join(), stamped.sum(), Stamper.has(stamped), Stamper.read(stamped));
for (const point of [plain, stamped, new Point()]) console.log("each", point.y, point instanceof Point, Stamper.has(point));
try {
  Stamper.read(plain);
} catch (error) {
  console.log("unstamped", error instanceof TypeError);
}
try {
  new Stamper(stamped);
} catch (error) {
  console.log("stamped twice", error instanceof TypeError);
}
