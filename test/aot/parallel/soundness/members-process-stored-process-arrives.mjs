// process reaches a parameter through ten calls, long after a value that the compiler cannot follow; members that exist are stored there by name and read back from process itself. ../../flow-schedules-beside-a-hidden-value.test.ts builds it under four schedules.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
const hide = value => new CustomEvent("x", { detail: value }).detail;
function put(object, value) {
  hide(object);
  object.title = value;
  object.exitCode = 0;
  object.emitWarning = value;
}
put(hide({ a: 1 }), "first");
const l0 = { get: () => process };
const l1 = { get: () => l0.get() };
const l2 = { get: () => l1.get() };
const l3 = { get: () => l2.get() };
const l4 = { get: () => l3.get() };
const l5 = { get: () => l4.get() };
const l6 = { get: () => l5.get() };
const l7 = { get: () => l6.get() };
const l8 = { get: () => l7.get() };
const l9 = { get: () => l8.get() };
try {
  put(l9.get(), "second");
} catch (error) {
  console.log(error.name, String(error.message).includes("read-only in a compiled executable"));
}
console.log(process.title, process.exitCode, typeof process.emitWarning, process.emitWarning.length);
