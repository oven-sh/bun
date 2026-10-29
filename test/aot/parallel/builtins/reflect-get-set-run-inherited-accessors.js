// Reflect.get and Reflect.set find an accessor on the target, or above it, and run it with the receiver as `this`: an object that the accessor does not hang above.
class Box {
  get value() {
    return this.stored;
  }
  stored = 1;
}
const other = { stored: "text" };
const got = Reflect.get(new Box(), "value", other);
console.log(typeof got, got.length);

const plain = {
  get size() {
    return this.items.length;
  },
  items: [1],
};
console.log(Reflect.get(plain, "size", { items: [1, 2, 3] }), Reflect.get(plain, "size", plain), plain.size);

const sink = {
  set size(n) {
    this.seen = n;
  },
  seen: 0,
};
const target = { seen: "none" };
console.log(Reflect.set(sink, "size", 5, target), sink.seen, target.seen);
console.log(Reflect.set(Object.create(sink), "size", 6, target), sink.seen, target.seen);

class Base {
  set v(x) {
    this.kept = [x];
  }
  get v() {
    return this.kept;
  }
}
class Derived extends Base {}
const holder = { kept: null };
Reflect.set(new Derived(), "v", 7, holder);
console.log(holder.kept.length, Reflect.get(new Derived(), "v", holder)[0], Reflect.get(new Derived(), "v", 5));
