// A descriptor literal leaves `get` out, and native code that asks it for `get` finds one all the same: above the descriptor, behind an accessor that runs code of the program, or in a property that left and came back.
// Other literals of the same shape hold a getter, so the field is one whose function is made on demand.
function honest(target, answer) {
  return Object.defineProperty(target, "x", { get() { return answer; }, configurable: true });
}
let rounds = 0;
for (let i = 0; i < 3000; i++) rounds += honest({}, i).x;
console.log("3000 honest rounds", rounds);

function attempt(label, run) {
  try {
    console.log(label, "->", run());
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

function inherited(box) {
  const descriptor = { configurable: true };
  Object.setPrototypeOf(descriptor, { get() { return box.held + 100; } });
  const target = Object.defineProperty({}, "x", descriptor);
  return target.x + " " + typeof descriptor.get + " " + Object.hasOwn(descriptor, "get");
}
attempt("a getter above the descriptor", () => inherited({ held: 1 }));

function behindAnAccessor(box) {
  const descriptor = { configurable: true };
  Object.setPrototypeOf(descriptor, {
    get get() {
      box.held = 50;
      box.extra = "added";
      return () => box.held + 1;
    },
  });
  const before = box.held;
  const target = Object.defineProperty({}, "x", descriptor);
  return before + " " + box.held + " " + box.extra + " " + target.x;
}
attempt("an accessor above the descriptor changes an object in the middle", () => behindAnAccessor({ held: 2 }));
for (let i = 0; i < 500; i++) behindAnAccessor({ held: i });
attempt("the same once it is hot", () => behindAnAccessor({ held: 3 }));

function ownAccessor(box) {
  const descriptor = { configurable: true };
  Object.defineProperty(descriptor, "get", { get() { box.held *= 2; return () => box.held; } });
  const before = box.held;
  const target = Object.defineProperty({}, "x", descriptor);
  return before + " " + box.held + " " + target.x;
}
attempt("an own accessor under the name", () => ownAccessor({ held: 4 }));

function deletedAndBack(answer) {
  const descriptor = { get() { return answer; }, configurable: true };
  const first = descriptor.get;
  delete descriptor.get;
  const without = Object.defineProperty({}, "x", descriptor);
  descriptor.extra = 1;
  descriptor.get = () => answer + 1;
  const withIt = Object.defineProperty({}, "x", descriptor);
  return without.x + " " + withIt.x + " " + (first === descriptor.get) + " " + Object.keys(descriptor).join();
}
attempt("deleted, then stored again", () => deletedAndBack(6));

function storedLater(answer) {
  const descriptor = { configurable: true };
  const empty = Object.defineProperty({}, "x", descriptor);
  descriptor.get = function () { return answer; };
  const filled = Object.defineProperty({}, "x", descriptor);
  return empty.x + " " + filled.x + " " + (Object.getOwnPropertyDescriptor(filled, "x").get === descriptor.get);
}
attempt("left out, then stored", () => storedLater(7));

function notAFunction(value) {
  const descriptor = { configurable: true };
  descriptor.get = value;
  return Object.defineProperty({}, "x", descriptor).x;
}
attempt("a number under the name", () => notAFunction(3));
attempt("undefined under the name", () => notAFunction(undefined));
attempt("a value beside a getter", () => Object.defineProperty({}, "x", { value: 1, get() { return 2; } }).x);

function frozen(answer) {
  const descriptor = Object.freeze({ get() { return answer; }, configurable: true });
  const target = Object.defineProperty({}, "x", descriptor);
  return target.x + " " + (Object.getOwnPropertyDescriptor(target, "x").get === descriptor.get) + " " + Object.isFrozen(descriptor);
}
attempt("a frozen descriptor", () => frozen(8));
