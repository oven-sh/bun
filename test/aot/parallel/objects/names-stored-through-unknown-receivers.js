// A name that is stored only through a receiver the compiler cannot follow is an extra property of the object it lands on: it hides methods, is found by name, by `in` and by every listing of keys, and can be deleted again.
class Point {
  constructor(x) {
    this.x = x;
  }
  norm() {
    return "method norm " + this.x;
  }
  get size() {
    return "getter size " + this.x;
  }
}
class Heir extends Point {
  constructor(x) {
    super(x);
    this.y = x + 1;
  }
  describe() {
    return "method describe " + this.y;
  }
}
class Bound {
  constructor() {
    this.run = () => "own run";
  }
  run() {
    return "method run";
  }
}

const hand = new Function("value", "return value");
const shelf = new Map();
function throughNativeCode(value) {
  let found;
  [value].forEach(function (each) {
    found = each;
  });
  return found;
}
function throughContainer(value) {
  shelf.set("kept", value);
  return shelf.get(String(["k", "e", "p", "t"].join("")));
}

function show(label, object) {
  console.log(
    label,
    "|",
    object.norm(),
    "|",
    object.size,
    "|",
    "extra" in object,
    object.extra,
    "|",
    Object.keys(object).join(),
    "|",
    JSON.stringify(object),
    "|",
    Object.hasOwn(object, "norm"),
    Object.hasOwn(object, "extra"),
  );
}

function listed(object) {
  const names = [];
  for (const name in object) names.push(name);
  return names.join();
}

for (const [way, pass] of [
  ["evaluated text", hand],
  ["native code", throughNativeCode],
  ["a container", throughContainer],
]) {
  const plain = new Point(1);
  const changed = new Point(2);
  const plainHeir = new Heir(3);
  const changedHeir = new Heir(4);
  for (const object of [changed, changedHeir]) {
    const input = pass(object);
    input.extra = "extra " + object.x;
    input.norm = function () {
      return "own norm " + this.x;
    };
    try {
      input.size = "stored size";
      console.log("no error");
    } catch (error) {
      console.log(error instanceof TypeError);
    }
  }
  console.log(way);
  show("plain", plain);
  show("changed", changed);
  show("plain heir", plainHeir);
  show("changed heir", changedHeir);
  console.log(plainHeir.describe(), changedHeir.describe(), listed(plain), listed(changed), listed(changedHeir));

  let total = 0;
  for (let i = 0; i < 1000; i++) {
    const object = i % 2 ? plain : changed;
    total += object.norm().length + (object.extra === undefined ? 0 : 1);
  }
  console.log(total);

  const again = pass(changed);
  console.log(delete again.norm, delete again.extra);
  show("changed back", changed);

  Object.defineProperty(pass(changedHeir), "describe", { value: () => "own describe", enumerable: false, configurable: true });
  console.log(changedHeir.describe(), plainHeir.describe(), Object.keys(changedHeir).join());
}

const record = { a: 1 };
const otherRecord = { a: 2 };
hand(record).b = 2;
hand(record).toString = () => "own toString";
console.log(record.b, otherRecord.b, Object.keys(record).join(), Object.keys(otherRecord).join(), `${record}`, `${otherRecord}`);

function fill(object) {
  object.late = "late " + object.x;
}
const filled = new Point(5);
fill(filled);
console.log(filled.late, Object.keys(filled).join(), new Point(6).late, "late" in new Point(7));

const known = new Point(8);
const handedOut = new Point(9);
for (const either of [hand(handedOut), known]) either.mixed = "mixed " + either.x;
console.log(known.mixed, handedOut.mixed, Object.keys(known).join(), Object.keys(handedOut).join(), new Point(10).mixed);

const bound = new Bound();
console.log(bound.run(), hand(bound).run(), delete hand(bound).run, bound.run());
