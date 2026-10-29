// process reaches a parameter that also takes a value that the compiler cannot follow; members that exist are stored there by name and read back from process itself. ../../flow-schedules.test.ts builds it under four schedules.
const hide = value => new CustomEvent("x", { detail: value }).detail;
function put(object, value) {
  hide(object);
  object.title = value;
  object.exitCode = 0;
  object.emitWarning = value;
}
put(hide({ a: 1 }), "first");
const l9 = { get: () => process };
put(l9.get(), "second");
console.log(process.title, process.exitCode, typeof process.emitWarning, process.emitWarning.length);
