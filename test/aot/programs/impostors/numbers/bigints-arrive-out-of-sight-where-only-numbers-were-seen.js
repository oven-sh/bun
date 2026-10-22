function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

class Square {
  constructor(side) {
    this.side = side;
  }
  area() {
    return this.side * this.side;
  }
  perimeter() {
    return this.side + this.side + this.side + this.side;
  }
  negated() {
    return -this.side;
  }
  grown() {
    this.side++;
    return this.side;
  }
  remainder() {
    return this.side % this.side;
  }
  bits() {
    return [this.side & this.side, this.side | this.side, this.side ^ this.side, ~this.side, this.side << this.side, this.side >> this.side];
  }
  compared() {
    return [this.side < this.side, this.side <= this.side, this.side == this.side, this.side === this.side];
  }
}

function square(x) {
  return x * x;
}

function twice(x) {
  return x + x;
}

function opposite(x) {
  return -x;
}

function successor(x) {
  return ++x;
}

function sumOfSquares(a, b) {
  return square(a) + square(b);
}

function describe(value) {
  return [value, typeof value, String(value)];
}

function describeSquare(shape) {
  return [describe(shape.area()), describe(shape.perimeter()), describe(shape.negated()), describe(shape.remainder()), shape.bits(), shape.compared(), describe(shape.grown()), describe(shape.side)];
}

let total = 0;
for (let i = 1; i < 2000; i++) {
  const shape = new Square(i & 15 || 1);
  total += shape.area() + shape.perimeter() + shape.negated() + shape.grown() + shape.remainder() + shape.bits()[0] + square(i) + twice(i) + opposite(i) + successor(i) + sumOfSquares(i, 1);
}
console.log("the honest total", total);

const name = ["si", "de"].join("");
const construct = new Function("constructor", "a", "return new constructor(a);");
const call = new Function("callee", "a", "b", "return callee(a, b);");
const make = side => new Square(side);

for (const text of ["5", "0", "-3", "2147483648", "9007199254740993", "123456789012345678901234567890"]) {
  const big = BigInt(text);
  attempt(text + "n stored under a computed name", () => {
    const shape = new Square(1);
    shape[name] = big;
    return describeSquare(shape);
  });
  attempt(text + "n given by Reflect.construct", () => describeSquare(Reflect.construct(Square, [big])));
  attempt(text + "n given by run-time text", () => describeSquare(construct(Square, big)));
  attempt(text + "n given by Object.assign", () => describeSquare(Object.assign(new Square(1), Object.fromEntries([[name, big]]))));
  attempt(text + "n given by a native callback", () => [big].map(make).map(describeSquare));
  attempt(text + "n mapped by the functions", () => [[big].map(square), [big].map(twice), [big].map(opposite), [big].map(successor)]);
  attempt(text + "n applied to the functions", () => [Reflect.apply(square, null, [big]), Reflect.apply(twice, null, [big]), Reflect.apply(sumOfSquares, null, [big, big])]);
  attempt(text + "n handed over by run-time text", () => [describe(call(square, big)), describe(call(twice, big)), describe(call(sumOfSquares, big, big))]);
  attempt(text + "n and a number handed over by run-time text", () => call(sumOfSquares, big, 1));
}

let again = 0;
for (let i = 1; i < 2000; i++) {
  const shape = new Square(i & 15 || 1);
  again += shape.area() + shape.perimeter() + shape.negated() + shape.grown() + shape.remainder() + shape.bits()[0] + square(i) + twice(i) + opposite(i) + successor(i) + sumOfSquares(i, 1);
}
console.log("the honest total again", again);
