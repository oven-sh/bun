// The constructor above keeps the object and fixes one of the names that the class below declares. The definition of that name throws, and the fields that were defined before it hold undefined.
const kept = [];
class Above {
  constructor() {
    kept.push(this);
    Object.defineProperty(this, "fixed", { value: "fixed" });
  }
}
class Numbers extends Above {
  count;
  ratio;
  fixed;
  constructor(v) {
    super();
    this.count = v;
    this.ratio = 0.5;
    this.fixed = "s";
  }
}
class Others extends Above {
  ready;
  name;
  #hidden;
  fixed;
  constructor(v) {
    super();
    this.ready = true;
    this.name = "n";
    this.#hidden = v;
    this.fixed = "s";
  }
  static hiddenOf(o) {
    return #hidden in o ? String(o.#hidden) : "no such name";
  }
}
class Whole extends Above {
  count;
  constructor(v) {
    super();
    this.count = v;
  }
}
console.log(new Whole(5).count);
for (const C of [Numbers, Others]) {
  try {
    new C(1);
  } catch (e) {
    console.log(e.constructor.name);
  }
  const o = kept[kept.length - 1];
  console.log(
    Object.keys(o).join(),
    JSON.stringify(o),
    String(o.count),
    String(o.ratio),
    String(o.ready),
    String(o.name),
    Others.hiddenOf(o),
  );
}
