// The prototype object of a class, the class object, and what stands above them, handed to the addon or reached from an instance: methods, accessors and static members change under code that calls them directly.
const loaded = { exports: {} };
process.dlopen(loaded, process.env.ADDON);
const attack = loaded.exports;
let at = 0;
function row(label, f) {
  let said;
  try {
    said = JSON.stringify(f());
  } catch (error) {
    said = "threw " + error.constructor.name;
  }
  console.log(String(++at).padStart(3) + " " + label + ": " + said);
}

// Every row gets classes of its own: what the addon does to a class lasts.
function family() {
  class Shape {
    static made = 0;
    static create(sides) {
      Shape.made++;
      return new this(sides);
    }
    constructor(sides) {
      this.sides = sides;
    }
    area() {
      return this.sides * 2;
    }
    get double() {
      return this.sides * 2;
    }
    describe() {
      return "shape " + this.area();
    }
  }
  class Square extends Shape {
    constructor(sides) {
      super(sides);
      this.kind = "square";
    }
    area() {
      return super.area() + 1;
    }
  }
  return { Shape, Square };
}
function use(shape) {
  let sum = 0;
  for (let round = 0; round < 200; round++) sum += shape.area() + shape.double;
  return [sum, shape.describe()];
}
function useStatics(Class) {
  let sum = 0;
  for (let round = 0; round < 200; round++) sum += Class.create(round & 3).sides + Class.made;
  return sum;
}
function look({ Shape, Square }) {
  return [use(new Shape(3)), use(new Square(4)), useStatics(Shape), useStatics(Square)];
}
const rows = {
  "untouched": () => "nothing",
  "a method replaced": ({ Shape }) => attack.store(Shape.prototype, "area", function () { return 100; }),
  "a method replaced in the class below": ({ Square }) => attack.store(Square.prototype, "area", function () { return 200; }),
  "a method replaced by a native function": ({ Shape }) => attack.defineMethod(Shape.prototype, "area"),
  "a method removed": ({ Square }) => attack.removeKey(Square.prototype, "area"),
  "a method removed from the base": ({ Shape }) => attack.removeKey(Shape.prototype, "describe"),
  "a method made a getter": ({ Shape }) => attack.defineGetter(Shape.prototype, "area"),
  "an accessor replaced by a value": ({ Shape }) => attack.defineValue(Shape.prototype, "double", 50, 7),
  "an accessor replaced by a native getter": ({ Shape }) => attack.defineGetter(Shape.prototype, "double"),
  "an accessor removed": ({ Shape }) => attack.removeKey(Shape.prototype, "double"),
  "a method added in the class below": ({ Square }) => attack.store(Square.prototype, "describe", function () { return "square " + this.sides; }),
  "a field's name defined on the prototype": ({ Shape }) => attack.defineGetter(Shape.prototype, "sides"),
  "the prototype reached from an instance": ({ Square }) => attack.storeIntoPrototypeOf(new Square(1), "area", function () { return 300; }),
  "the class reached from an instance": ({ Shape }) => attack.storeInto(new Shape(1), "constructor", "made", 1000),
  "the prototype reached from the class": ({ Shape }) => attack.storeInto(Shape, "prototype", "area", function () { return 400; }),
  "the prototype frozen": ({ Shape }) => attack.freeze(Shape.prototype),
  "another object above the prototype below": ({ Square }) => attack.setPrototype(Square.prototype, { area() { return 500; }, double: 1, describe() { return "other"; } }),
  "an object between the prototypes": ({ Shape, Square }) => attack.setPrototype(Square.prototype, Object.create(Shape.prototype, { double: { value: 9 } })),
  "a static field stored": ({ Shape }) => attack.store(Shape, "made", 5000),
  "a static field stored with a string": ({ Shape }) => attack.store(Shape, "made", "s"),
  "a static field removed": ({ Shape }) => attack.removeKey(Shape, "made"),
  "a static field made a getter": ({ Shape }) => attack.defineGetter(Shape, "made"),
  "a static field hidden in the class below": ({ Square }) => attack.store(Square, "made", -1),
  "a static method replaced": ({ Shape }) => attack.store(Shape, "create", function (sides) { return { sides: sides + 10 }; }),
  "a static method hidden in the class below": ({ Square }) => attack.store(Square, "create", function () { return { sides: 7 }; }),
  "a static method removed": ({ Shape }) => attack.removeKey(Shape, "create"),
  "the class object frozen": ({ Shape }) => attack.freeze(Shape),
  "another class above the class below": ({ Square }) => attack.setPrototype(Square, class Other { static made = 3; static create() { return { sides: 1 }; } constructor() { this.sides = 77; } }),
};
for (const [label, change] of Object.entries(rows)) {
  row(label, () => { const classes = family(); const before = look(classes); const said = change(classes); return [said, JSON.stringify(before) === JSON.stringify(look(family())), look(classes)]; });
  row(label + ", before anything used the classes", () => { const classes = family(); return [change(classes), look(classes)]; });
}
row("changed inside the loop", () => {
  const { Shape, Square } = family();
  const square = new Square(2);
  let sum = 0;
  for (let round = 0; round < 60; round++) {
    sum += square.area();
    if (round === 20) attack.store(Shape.prototype, "area", function () { return 1000; });
    if (round === 40) attack.storeIntoPrototypeOf(square, "area", function () { return 5; });
    sum += square.area() + square.double;
  }
  return sum;
});
row("made by the addon", () => { const { Shape, Square } = family(); return [use(attack.construct(Shape, 5)), use(attack.construct(Square, 6)), attack.construct(Square, 1) instanceof Shape, attack.call(Shape, Shape.create, 2).sides, Shape.made]; });
row("made by the addon after the class below got another parent", () => {
  const { Square } = family();
  attack.setPrototype(Square, class Other { constructor(sides) { this.other = sides; } });
  return [JSON.stringify(attack.construct(Square, 6)), JSON.stringify(new Square(7))];
});
