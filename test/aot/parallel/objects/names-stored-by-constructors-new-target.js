// Classes that reach native code may be constructed under any new.target: what a constructor stores under a name that no class declares is found on the instance, whichever class the instance gets its shape from.
// STATISTIC: FlowAppendedFields <= 8
function throughNativeCode(value) {
  let found;
  [value].forEach(function (each) {
    found = each;
  });
  return found;
}
function mark(object, value) {
  object.mark = value;
}
function stamp(object, value) {
  object.stamp = value;
}
function seal(object, value) {
  object.seal = value;
}

class Point {
  constructor(x) {
    this.x = x;
    mark(this, x + 1);
  }
  norm() {
    return "norm " + this.x + " " + this.mark;
  }
}
class Box {
  constructor(w) {
    this.w = w;
    stamp(this, w * 2);
  }
  area() {
    return "area " + this.w + " " + this.stamp;
  }
}
class Heir extends Point {
  constructor(x) {
    super(x);
    this.y = x + 10;
    seal(this, "heir");
  }
}
class HeirOfSomething extends throughNativeCode(Point) {
  constructor(x) {
    super(x);
    this.z = x + 20;
  }
}
class Stranger {
  constructor() {
    this.own = "own";
  }
  mark() {
    return "method mark";
  }
  get stamp() {
    return "getter stamp";
  }
}

function show(label, object) {
  const names = ["x", "w", "y", "z", "own", "mark", "stamp", "seal"];
  console.log(
    label,
    "|",
    Object.keys(object).join(),
    "|",
    JSON.stringify(object),
    "|",
    names.filter(name => name in object).join(),
    "|",
    names.filter(name => Object.hasOwn(object, name)).join(),
    "|",
    typeof object.mark,
    typeof object.stamp,
    "|",
    Object.getPrototypeOf(object).constructor.name,
  );
}

const classes = [Point, Box, Heir, HeirOfSomething, Stranger].map(throughNativeCode);
globalThis.publish?.(classes);
for (const constructed of classes) {
  for (const target of classes) {
    let made;
    try {
      made = Reflect.construct(constructed, [3], target);
    } catch (error) {
      console.log(constructed.name, "as", target.name, "throws", error.constructor.name);
      continue;
    }
    show(constructed.name + " as " + target.name, made);
  }
}

show("new Point", new Point(1));
show("new Box", new Box(2));
show("new Heir", new Heir(3));
show("new HeirOfSomething", new HeirOfSomething(4));
show("new Stranger", new Stranger());
console.log(new Point(5).norm(), "|", new Box(6).area(), "|", new Heir(7).norm(), "|", new HeirOfSomething(8).norm(), "|", new Stranger().mark(), new Stranger().stamp);
