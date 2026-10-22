function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

function Shape(sides) {
  this.sides = sides;
}
Shape.prototype.describe = function () {
  return "a shape with " + this.sides + " sides";
};
Shape.prototype.family = "shapes";

function Solid(sides) {
  this.faces = sides;
}
Solid.prototype.describe = function () {
  return "a solid with " + this.faces + " faces and " + this.sides + " sides";
};
Solid.prototype.family = "solids";
Solid.prototype.volume = function () {
  return this.sides * 10;
};

function Square() {
  Shape.call(this, 4);
  this.corner = 90;
}
Square.prototype = Object.create(Shape.prototype);
Square.prototype.constructor = Square;
Square.prototype.cornerSum = function () {
  return this.corner * this.sides;
};

function makeSquare() {
  return new Square();
}

function describe(shape) {
  return shape.describe();
}

function familyOf(shape) {
  return shape.family;
}

function volumeOf(shape) {
  return shape.volume();
}

function look(label, shape) {
  attempt(label + ": describe()", () => describe(shape));
  attempt(label + ": family", () => familyOf(shape));
  attempt(label + ": volume()", () => volumeOf(shape));
  attempt(label + ": cornerSum()", () => shape.cornerSum());
  attempt(label + ": instanceof Shape, Solid, Square", () => [shape instanceof Shape, shape instanceof Solid, shape instanceof Square].join());
}

const old = makeSquare();
let length = 0;
for (let i = 0; i < 2000; i++) length += describe(i % 2 ? old : makeSquare()).length + familyOf(old).length;
console.log("2000 honest calls", length);
look("before any swap", old);

Object.setPrototypeOf(Square.prototype, Solid.prototype);
look("setPrototypeOf gave Square another parent, an old square", old);
look("setPrototypeOf gave Square another parent, a new square", makeSquare());

Square.prototype.__proto__ = Shape.prototype;
look("__proto__ gave the first parent back, an old square", old);

Reflect.setPrototypeOf(Square.prototype, null);
look("Square has no parent, an old square", old);
attempt("Square has no parent: toString", () => typeof old.toString);

Object[["setPrototype", "Of"].join("")](Square.prototype, Solid.prototype);
look("setPrototypeOf under a joined name gave Square another parent, an old square", old);

Object.setPrototypeOf(Square.prototype, Shape.prototype);
Object.setPrototypeOf(Shape.prototype, Solid.prototype);
look("the parent itself got a parent, an old square", old);
look("the parent itself got a parent, a plain shape", new Shape(3));

delete Shape.prototype.describe;
delete Shape.prototype.family;
look("the parent lost its members, an old square", old);

Object.setPrototypeOf(old, Solid.prototype);
look("one square alone was moved under Solid", old);
look("another square was not", makeSquare());

function Catcher() {}
Object.defineProperty(Catcher.prototype, "corner", {
  get() {
    return "corner from the getter";
  },
  set(value) {
    this.caught = value;
  },
});
Catcher.prototype.describe = function () {
  return "under the catcher";
};
Object.setPrototypeOf(Square.prototype, Catcher.prototype);
attempt("a parent with an accessor for a field that Square stores: keys", () => Object.keys(makeSquare()).join());
attempt("a parent with an accessor for a field that Square stores: corner", () => makeSquare().corner);
attempt("an old square keeps its own corner", () => [Object.keys(old).join(), old.corner].join(" "));
Object.setPrototypeOf(Square.prototype, Shape.prototype);
attempt("back under Shape: keys", () => Object.keys(makeSquare()).join());

length = 0;
for (let i = 0; i < 2000; i++) length += describe(makeSquare()).length;
console.log("2000 calls at the end", length);
