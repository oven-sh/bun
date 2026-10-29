// Descriptors written as literals. Some hold a getter or a setter, some leave both out, and to the compiler all of them are records of one shape.
// The functions in them are made when somebody asks for them, and the one who asks here is native code.
const changes = [
  point => void Object.defineProperty(point, "x", { writable: false }),
  point => void Object.defineProperty(point, "x", { get: () => 3.5, configurable: true }),
  point => void Object.defineProperty(point, "x", { value: "defined" }),
  point => void Object.defineProperty(point, "x", { set(value) { this.y = value; }, configurable: true }),
  point => void Object.defineProperty(point, "x", { enumerable: false }),
];
for (const change of changes) {
  const point = { x: 1, y: 2 };
  change(point);
  try {
    point.x = 5;
  } catch (error) {
    console.log(error.constructor.name);
  }
  console.log(point.x, point.y, Object.keys(point).join());
}

function defineValue(target, value) {
  return Object.defineProperty(target, "size", { value, writable: true, configurable: true });
}
function defineGetter(target, answer) {
  return Object.defineProperty(target, "size", { get() { return answer * 2; }, configurable: true });
}
function defineBoth(target, box) {
  return Object.defineProperty(target, "size", { get: () => box.held, set: value => { box.held = value % 7; }, configurable: true, enumerable: true });
}
function defineWith(target, descriptor) {
  const before = descriptor.get;
  Object.defineProperty(target, "size", descriptor);
  const found = Object.getOwnPropertyDescriptor(target, "size");
  return [typeof before, before === descriptor.get, found.get === descriptor.get, found.set === descriptor.set, "get" in descriptor, "value" in descriptor].join();
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const target = { held: i };
  defineValue(target, i);
  sum += target.size;
  defineGetter(target, i);
  sum += target.size;
  const box = { held: 1 };
  defineBoth(target, box);
  target.size = i;
  sum += target.size + box.held;
  defineValue(target, 1);
  sum += target.size;
}
console.log("3000 rounds", sum);

const target = {};
console.log(defineWith(target, { value: 4, configurable: true }), target.size);
console.log(defineWith(target, { get() { return 5; }, configurable: true }), target.size);
console.log(defineWith(target, { set(value) { sum = value; }, configurable: true }), target.size);
target.size = 11;
console.log(sum);
console.log(defineWith(target, { get: undefined, set: undefined, configurable: true }), target.size);
console.log(defineWith(target, { configurable: true }), target.size);

const many = Object.defineProperties({}, {
  plain: { value: 1, enumerable: true },
  computed: { get() { return this.plain + 1; }, enumerable: true },
  stored: { get() { return sum; }, set(value) { sum = value * 3; }, enumerable: true },
});
many.stored = 5;
console.log(JSON.stringify(many), Reflect.defineProperty(many, "plain", { get() { return 9; } }), many.plain);
const created = Object.create({ above: 1 }, { own: { value: 2, enumerable: true }, asked: { get() { return this.own + this.above; } } });
console.log(created.own, created.asked, Object.keys(created).join());
