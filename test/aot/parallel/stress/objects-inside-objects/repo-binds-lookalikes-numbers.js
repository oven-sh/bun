// Objects inside objects: repo binds impostors numbers constructors that only see integer arguments are called out of sight. It prints what plain Bun prints.
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

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
  cell() {
    return [this.x | 0, this.y & 15];
  }
  moved() {
    this.x++;
    this.y -= 1;
    return [this.x, this.y];
  }
}

function Size(width, height) {
  this.width = width;
  this.height = height;
}
Size.prototype.area = function () {
  return this.width * this.height;
};
Size.prototype.grown = function () {
  this.width += 1;
  return [this.width, this.height];
};

function makePair(first, second) {
  return { first, second };
}

function pairSum(pair) {
  return [pair.first + pair.second, pair.first | 0, pair.second * 2];
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const point = new Point(i, 1);
  const size = new Size(i, 2);
  total += point.sum() + point.cell()[0] + point.moved()[0] + size.area() + size.grown()[0] + pairSum(makePair(i, 3))[0];
}
console.log("the honest total", total);

const construct = new Function("constructor", "a", "b", "return new constructor(a, b);");
const call = new Function("callee", "a", "b", "return callee(a, b);");
const late = JSON.parse('["3", "", 0.5, -0, null, true, 2147483647, 2147483648, -2147483647, [3], {}]').concat([undefined, NaN, 3n]);

function describePoint(point) {
  return [point.x, point.y, outcome(() => point.sum()), outcome(() => point.cell()), outcome(() => point.moved()), Object.keys(point)];
}

function describeSize(size) {
  return [size.width, size.height, outcome(() => size.area()), outcome(() => size.grown())];
}

for (const value of late) {
  const label = show(value);
  attempt("run-time text makes a Point of " + label, () => describePoint(construct(Point, value, 1)));
  attempt("run-time text makes a Point with a second " + label, () => describePoint(construct(Point, 1, value)));
  attempt("Reflect.construct makes a Point of " + label, () => describePoint(Reflect.construct(Point, [value, value])));
  attempt("a bound constructor makes a Point of " + label, () => describePoint(new (Point.bind(null, ...[value]))(1)));
  attempt("run-time text makes a Size of " + label, () => describeSize(construct(Size, value, 2)));
  attempt("apply fills a Size with " + label, () => {
    const size = Object.create(Size.prototype);
    Size.apply(size, [value, 2]);
    return describeSize(size);
  });
  attempt("run-time text makes a pair of " + label, () => pairSum(call(makePair, value, 3)));
  attempt("map makes pairs of " + label, () => [value].map(makePair).map(pairSum));
}
attempt("run-time text leaves out the arguments", () => describePoint(construct(Point)));
attempt("honest objects afterwards", () => [describePoint(new Point(1, 2)), describeSize(new Size(3, 4)), pairSum(makePair(1, 2))]);
