// Reflect.get(base, name, receiver) and `super.name`: a value of the base's own is the answer whoever asks, and a getter that lies there is called for the receiver.
function point(x, y) {
  return { x, y };
}

function xOfPoint(base, receiver) {
  return Reflect.get(base, "x", receiver);
}

const log = [];
const watcher = new Proxy(
  {},
  {
    get(target, key) {
      log.push(String(key));
      return "trap";
    },
  },
);

const p = point(1, 2);
console.log(xOfPoint(p, watcher), xOfPoint(p, 5), xOfPoint(p, undefined), xOfPoint(p, p), xOfPoint(Object.freeze(point(3, 4)), null));

let total = 0;
for (let i = 0; i < 50; i++) total += xOfPoint(point(i, 0), watcher);
console.log(total, log.length);

const q = Object.setPrototypeOf(point(6, 7), {
  get x() {
    return "above for " + typeof this;
  },
});
console.log(xOfPoint(q, 1));
delete q.x;
console.log(xOfPoint(q, 1), xOfPoint(q, "text"), xOfPoint(q, q));

const r = point(8, 9);
Object.defineProperty(r, "x", {
  get() {
    return "getter for " + String(this);
  },
  configurable: true,
});
console.log(xOfPoint(r, 12));

function scaled(scale) {
  return {
    scale,
    get x() {
      return typeof this === "object" && this !== null ? this.scale * 10 : typeof this;
    },
  };
}

function xOfScaled(base, receiver) {
  return Reflect.get(base, "x", receiver);
}

const s = scaled(1);
console.log(xOfScaled(s, s), xOfScaled(s, scaled(2)), xOfScaled(s, { scale: 3 }), xOfScaled(s, 4), xOfScaled(s, undefined), xOfScaled(s, null));
console.log(xOfScaled(s, watcher), log.join());

function xOfSetterAlone(base, receiver) {
  return Reflect.get(base, "x", receiver);
}
console.log(xOfSetterAlone({ set x(value) {} }, 1));

function lengthFor(list, receiver) {
  return Reflect.get(list, "length", receiver);
}
class Stack extends Array {}
console.log(lengthFor([1, 2, 3], { length: 9 }), lengthFor(new Stack(4), watcher), lengthFor([], 0), log.length);

const base = {
  x: "of base",
  get y() {
    return "y for " + this.name;
  },
};
const derived = {
  __proto__: base,
  name: "derived",
  x: "own",
  readX() {
    return super.x;
  },
  readY() {
    return super.y;
  },
};
console.log(derived.readX(), derived.readY(), derived.readY.call({ name: "other" }));
base.x = "changed";
console.log(derived.readX());
delete base.x;
console.log(derived.readX());
Object.setPrototypeOf(derived, { x: "of another base" });
console.log(derived.readX(), derived.readY());

export {};
