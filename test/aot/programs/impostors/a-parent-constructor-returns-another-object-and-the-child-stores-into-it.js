const kept = [];
class Parent {
  p = 1;
  constructor(mode) {
    if (mode === 1) return { other: true };
    if (mode === 2) return kept[0];
    if (mode === 3) return new Proxy(this, {});
    if (mode === 4) return function () {};
    if (mode === 5) return [1, 2];
    if (mode === 6) return new Stranger();
    if (mode === 7) return Object.freeze({ frozen: true });
    if (mode === 8) return 5;
    kept.push(this);
  }
}
class Stranger {
  s = "stranger";
  c = "the c of Stranger";
}
class Child extends Parent {
  c = 2;
  constructor(mode) {
    super(mode);
    this.d = mode * 10;
  }
  hello() {
    return "child";
  }
}
class Grandchild extends Child {
  g = "g";
  constructor(mode) {
    super(mode);
    this.h = this.d + 1;
  }
}

for (const made of [Child, Grandchild]) {
  for (let round = 0; round < 3; round++) {
    for (let mode = 0; mode < 9; mode++) {
      try {
        const o = new made(mode);
        console.log(made.name, mode, typeof o, Array.isArray(o), Reflect.ownKeys(o).join(), o.c, o.d, o.g, o.h, o.p, o.s, o instanceof Child, o instanceof Parent, o instanceof Stranger, typeof o.hello);
      } catch (error) {
        console.log(made.name, mode, "threw", error.constructor.name);
      }
    }
  }
}
console.log(kept.length, Object.keys(kept[0]).join(), kept[0].d, kept[0].h);
