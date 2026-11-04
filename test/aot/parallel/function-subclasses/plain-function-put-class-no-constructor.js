// `super(..)` runs whatever lies above the class at that moment. A function that is no class stores nothing, so the fields that the classes above would have stored are not there.
function show(o) {
  try {
    return [String(o.side), o.side + 1, String(o.text), o.text?.length, String(o.box), o.box?.n, Object.keys(o).join()].join(" ");
  } catch (error) {
    return "threw " + error.name;
  }
}
class Shape {
  constructor(side) {
    this.side = side;
    this.text = "t" + side;
    this.box = { n: side };
  }
}

class Implicit extends Shape {}
Object.setPrototypeOf(Implicit, function () {});
console.log("implicit", show(new Implicit(3)));

class Explicit extends Shape {
  constructor(n) {
    super(n);
    this.extra = n;
  }
}
Reflect.setPrototypeOf(Explicit, function () {});
console.log("explicit", show(new Explicit(3)), new Explicit(3).extra + 1);

class ByProto extends Shape {}
ByProto.__proto__ = function () {};
console.log("__proto__", show(new ByProto(3)));

class Middle extends Shape {
  constructor(n) {
    super(n);
    this.middle = "m" + n;
  }
}
class Leaf extends Middle {
  constructor(n) {
    super(n);
    this.leaf = n * 2;
  }
}
Object.setPrototypeOf(Middle, function () {});
const leaf = new Leaf(3);
console.log("middle", show(leaf), leaf.middle.length, leaf.leaf + 1);

class Initialized extends Shape {
  twice = this.side * 2;
  long = this.text?.length;
}
Object.setPrototypeOf(Initialized, function () {});
const initialized = new Initialized(3);
console.log("initializers", show(initialized), initialized.twice, initialized.long);

class WithMethods extends Shape {
  area() {
    return this.side * this.side;
  }
  name() {
    return this.text.toUpperCase();
  }
}
Object.setPrototypeOf(WithMethods, function () {});
const list = [new WithMethods(3), new WithMethods(4)];
let sum = 0;
for (let turn = 0; turn < 100; turn++) for (const each of list) sum += each.area();
console.log("methods", sum);
try {
  console.log(list[0].name());
} catch (error) {
  console.log("threw", error.name);
}

class StoresSome extends Shape {}
Object.setPrototypeOf(StoresSome, function () {
  this.side = "text";
});
console.log("stores some", show(new StoresSome(3)));

function replace(target, parent) {
  Object.setPrototypeOf(target, parent);
}
class ThroughHelper extends Shape {}
replace(ThroughHelper, function () {});
replace({}, null);
console.log("helper", show(new ThroughHelper(3)));

class Fields {
  side = 1.5;
  text = "t";
  box = { n: 2 };
}
class BelowFields extends Fields {}
Object.setPrototypeOf(BelowFields, function () {});
console.log("fields", show(new BelowFields()), show(new Fields()));

console.log("the class above", show(new Shape(1.5)));
