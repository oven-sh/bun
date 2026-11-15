// Under: --aot-testing=CheckProofsAtRunTime: what is proven of a field that a descriptor fills is asked again at run time
// The descriptor is not written at the call: what it holds under `value` at that moment lies under the name. Each block is a way in which the descriptor is, or stops being, a plain record that lays a value.
function tryTo(deed) {
  try { return deed(); } catch (error) { return error.name; }
}
const shared = { value: undefined, enumerable: false };
function lay(value) {
  const made = { id: 1 };
  shared.value = value;
  Object.defineProperty(made, "inner", shared);
  shared.value = undefined;
  return made;
}
const withObject = lay({ kind: "object", seen: 0 });
withObject.inner.run = step => { withObject.inner.seen += step.by; return withObject.inner.seen; };
console.log(withObject.inner.run({ by: 2 }), withObject.inner.run({ by: 3 }), withObject.inner.kind, Object.keys(withObject).join(), lay(7).inner + 1, lay("text").inner.length, lay().inner);

const one = { value: 1, writable: true }, other = { value: { two: 2 }, enumerable: true };
function layEither(flag) {
  const made = {};
  Object.defineProperty(made, "held", flag ? one : other);
  return made;
}
console.log(layEither(true).held, layEither(false).held.two, Object.keys(layEither(false)).join(), Object.keys(layEither(true)).length);

const turnsAccessor = { value: 5, configurable: true };
function layTurning() {
  const made = {};
  return tryTo(() => Object.defineProperty(made, "held", turnsAccessor).held);
}
console.log(layTurning());
delete turnsAccessor.value;
turnsAccessor.get = function () { return this === undefined ? "no this" : "got"; };
console.log(layTurning());

const byKey = { value: 6 };
function layByKey() {
  const made = {};
  return tryTo(() => Object.defineProperty(made, "held", byKey).held);
}
console.log(layByKey());
delete byKey.value;
byKey[process.argv.length > 99 ? "x" : "get"] = () => "got by key";
console.log(layByKey());

const handedOut = { value: { mark: 1 } };
function layHandedOut() {
  const made = {};
  Object.defineProperty(made, "held", handedOut);
  return made.held;
}
console.log(layHandedOut().mark);
globalThis.keptDescriptor = handedOut;
globalThis.keptDescriptor.value = "changed from outside";
console.log(layHandedOut());

const above = { value: "from above" };
const below = Object.create(above);
console.log(tryTo(() => Object.defineProperty({}, "held", below).held));
class Described { constructor(value) { this.value = value; } get enumerable() { return true; } }
const described = Object.defineProperty({}, "held", new Described("of a class"));
console.log(described.held, Object.keys(described).join());
console.log(tryTo(() => Object.defineProperty({}, "held", undefined)), tryTo(() => Object.defineProperty({}, "held", 5)));
const empty = {};
const laidEmpty = Object.defineProperty({}, "held", empty);
console.log(laidEmpty.held, "held" in laidEmpty);
const undefinedGetter = { get: undefined };
console.log(Object.getOwnPropertyDescriptor(Object.defineProperty({}, "held", undefinedGetter), "held").hasOwnProperty("get"));
const both = { value: 1 };
both.set = undefined;
console.log(tryTo(() => Object.defineProperty({}, "held", both).held));
