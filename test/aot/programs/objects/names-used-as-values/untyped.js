const keyText = key => (typeof key === "symbol" ? key.toString() : key);

const base = {
  set width(v) { this.stored = "setter " + v; },
};

class Parent {
  set depth(v) { this.seen = "parent " + v; }
}
class Child extends Parent {
  assign(v) {
    super.depth = v;
    super.plain = v + 1;
    return Reflect.ownKeys(this).map(keyText).join() + " " + this.seen + " " + this.plain;
  }
}

export function storeThroughSuper(tag, v) {
  const derived = {
    __proto__: base,
    assign(value) {
      super.width = value;
      super.height = value + 1;
      super[tag] = value + 2;
      return Reflect.ownKeys(this).map(keyText).join() + " " + this.stored + " " + this.height + " " + this[tag];
    },
  };
  return derived.assign(v) + " | " + new Child().assign(v);
}
