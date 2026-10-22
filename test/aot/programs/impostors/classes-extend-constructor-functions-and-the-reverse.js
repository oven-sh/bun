const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  let line;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

function Old(size) {
  this.size = size;
  this.madeWith = new.target === undefined ? "no new" : new.target === Old ? "Old" : "a child";
}
Old.prototype.describe = function () {
  return "old " + this.size;
};
Old.count = function () {
  return "counted by " + this.name;
};

class Plain extends Old {}

class Adds extends Old {
  constructor(size) {
    super(size);
    this.more = "more";
  }
  describe() {
    return "adds, " + super.describe();
  }
}

class HasFields extends Old {
  more = "field";
  size = "field over the parent's store";
}

class HasSetter extends Old {
  get size() {
    return "from the getter, kept " + this.kept;
  }
  set size(value) {
    log.push("set size " + value);
    this.kept = value;
  }
}

class HasGetterOnly extends Old {
  get size() {
    return "getter only";
  }
}

class Modern {
  constructor(size) {
    this.size = size;
    this.madeWith = new.target === Modern ? "Modern" : "a child";
  }
  describe() {
    return "modern " + this.size;
  }
}

function CallsTheClass(size) {
  Modern.call(this, size);
}
CallsTheClass.prototype = Object.create(Modern.prototype);

function ConstructsTheClass(size) {
  const made = Reflect.construct(Modern, [size], new.target || ConstructsTheClass);
  made.more = "more";
  return made;
}
Object.setPrototypeOf(ConstructsTheClass.prototype, Modern.prototype);
Object.setPrototypeOf(ConstructsTheClass, Modern);
ConstructsTheClass.prototype.describe = function () {
  return "constructs, " + Modern.prototype.describe.call(this);
};

function BorrowsOnlyThePrototype(size) {
  this.size = size;
}
BorrowsOnlyThePrototype.prototype = Object.create(Modern.prototype);

class OnTop extends ConstructsTheClass {
  top = "top";
}

function make(Maker, size) {
  return new Maker(size);
}

function describe(thing) {
  return thing.describe();
}

function sizeOf(thing) {
  return thing.size;
}

const makers = [Old, Plain, Adds, HasFields, HasSetter, HasGetterOnly, Modern, CallsTheClass, ConstructsTheClass, BorrowsOnlyThePrototype, OnTop];

function look(phase) {
  for (const Maker of makers) {
    attempt(phase + " | new " + Maker.name, () => make(Maker, 3));
    attempt(phase + " | " + Maker.name + ": describe()", () => describe(make(Maker, 3)));
    log.length = 0;
    attempt(phase + " | " + Maker.name + ": size", () => { const made = make(Maker, 3); log.length = 0; return sizeOf(made); });
    attempt(phase + " | " + Maker.name + ": instanceof itself, Old, Modern", () => { const made = make(Maker, 3); log.length = 0; return [made instanceof Maker, made instanceof Old, made instanceof Modern]; });
  }
}

look("at first");
let length = 0;
for (let i = 0; i < 2000; i++) length += describe(make(Old, i % 5)).length + describe(make(Adds, i % 5)).length + describe(make(Modern, i % 5)).length + sizeOf(make(Plain, 1));
console.log("2000 honest rounds", length);
look("later");

attempt("statics through a class child", () => [Plain.count(), Adds.count(), Object.getPrototypeOf(Plain) === Old]);
attempt("Old without new", () => Old(1));
attempt("a class child without new", () => Plain(1));
attempt("ConstructsTheClass without new", () => ConstructsTheClass(1));
Old.prototype.describe = function () {
  return "patched old " + this.size;
};
attempt("after the parent function's method was patched", () => [describe(make(Plain, 1)), describe(make(Adds, 1))]);
Old.prototype = { describe: () => "a replaced prototype" };
attempt("after the parent function's prototype was replaced", () => [describe(make(Old, 1)), describe(make(Plain, 1)), make(Plain, 1) instanceof Old]);
