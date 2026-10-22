// Untyped JavaScript, strict. Loops over instances of a class, of a derived class and of a constructor function read and fill a property that is added late.
// A callback that the loop calls puts the name on a prototype in the middle: as a value, as a getter, as a setter, on the class itself and on its base.
const log = [];
class Shape {
  constructor(id) {
    this.id = id;
  }
}
class Circle extends Shape {
  constructor(id) {
    super(id);
    this.radius = id & 3;
  }
}
function Box(id) {
  this.id = id;
}
function sumAreas(list, visit) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    const shape = list[i];
    const before = shape.area;
    visit(i, shape);
    const after = shape.area;
    sum += (before === undefined ? 1 : before) + (after === undefined ? 1 : after);
  }
  return sum;
}
function fillAreas(list, visit) {
  let filled = 0;
  for (let i = 0; i < list.length; i++) {
    const shape = list[i];
    visit(i, shape);
    shape.area = i & 7;
    if (Object.hasOwn(shape, "area")) filled++;
  }
  return filled;
}
function listOf(make) {
  const list = [];
  for (let i = 0; i < 3000; i++) list.push(make(i));
  return list;
}
const nothing = () => {};
const cases = [
  ["a class, a value", id => new Shape(id), Shape.prototype, { value: 10, writable: true, configurable: true }],
  ["a derived class, a getter on the base", id => new Circle(id), Shape.prototype, { get() { return this.id & 1; }, configurable: true }],
  ["a derived class, a setter on itself", id => new Circle(id), Circle.prototype, { set(value) { if (log.length < 3) log.push("area = " + value); }, configurable: true }],
  ["a constructor function, a read-only value", id => new Box(id), Box.prototype, { value: 20, writable: false, configurable: true }],
];
for (const [label, make, holder, descriptor] of cases) {
  const name = ["ar", "ea"].join("");
  const change = (i, shape) => {
    if (i === 1500) Object.defineProperty(Object.getPrototypeOf(shape) === holder ? Object.getPrototypeOf(shape) : holder, name, descriptor);
  };
  const quiet = sumAreas(listOf(make), nothing);
  const read = sumAreas(listOf(make), change);
  const afterwards = sumAreas(listOf(make), nothing);
  delete holder[name];
  const filledQuietly = fillAreas(listOf(make), nothing);
  let filled;
  try {
    filled = fillAreas(listOf(make), change);
  } catch (error) {
    filled = error.constructor.name;
  }
  delete holder[name];
  console.log(`${label}: ${quiet} ${read} ${afterwards} | ${filledQuietly} ${filled} | ${sumAreas(listOf(make), nothing)} ${log.join(", ")}`);
  log.length = 0;
}
