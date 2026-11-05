// The arguments of a strict function have an accessor under `callee` that throws. Their descriptors are defined on objects that nothing else is done to, and `callee` is read or stored there.
// Flags: --aot-validate
function attempt(run) { try { return String(run()); } catch (error) { return "THROWS " + error.constructor.name; } }
function strict() { "use strict"; return arguments; }
function onALiteral() {
  const copy = Object.defineProperties({ name: "own", x: "own", length: "own" }, Object.getOwnPropertyDescriptors(strict(1, 2)));
  return { callee: copy.callee };
}
function onACopyOfACopy() {
  const first = Object.defineProperties({ a: 1 }, Object.getOwnPropertyDescriptors(strict(1, 2)));
  const second = Object.defineProperties({ b: 2 }, Object.getOwnPropertyDescriptors(first));
  return second.callee;
}
function onACreatedObject() {
  const made = Object.create({ above: 1 }, Object.getOwnPropertyDescriptors(strict(1, 2)));
  return made.callee;
}
function stored() {
  const copy = Object.defineProperties({ a: 1 }, Object.getOwnPropertyDescriptors(strict(1, 2)));
  copy.callee = 3;
  return "stored";
}
function readBelow() {
  const copy = Object.defineProperties({ a: 1 }, Object.getOwnPropertyDescriptors(strict(1, 2)));
  return Object.create(copy).callee;
}
function unread() {
  const copy = Object.defineProperties({ a: 1 }, Object.getOwnPropertyDescriptors(strict(1, 2)));
  copy.callee;
  return "not thrown";
}
function asked() {
  const copy = Object.defineProperties({ a: 1 }, Object.getOwnPropertyDescriptors(strict(1, 2)));
  const half = Object.getOwnPropertyDescriptor(copy, "callee");
  return ["callee" in copy, Object.getOwnPropertyNames(copy).join(), typeof half.get, half.get === half.set, half.enumerable, copy.length, copy[0], copy.a].join(" ");
}
for (const run of [onALiteral, onACopyOfACopy, onACreatedObject, stored, readBelow, unread, asked]) console.log(run.name, attempt(run));
