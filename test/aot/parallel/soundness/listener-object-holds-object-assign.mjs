// Object.assign is bound to an object and to a second one, and the bound function is the handleEvent of a listener object. An event is dispatched, and the first object holds what the second one held, and what the event lists.
// The file also names eval and JSON.parse, in a branch that is not taken, and Reflect.get. ../../flow-schedules-beside-a-hidden-value.test.ts builds it under four schedules.
if (process.argv.length > 99) {
  (0, eval)(process.argv[9]);
  Object.assign({}, JSON.parse(process.argv[10]));
}
console.log(Reflect.get({ inner: 1 }, "inner"));
function main() {
  const o = { a: 1 };
  const target = new EventTarget();
  target.addEventListener("e", { handleEvent: Object.assign.bind(null, o, { a: "changed" }) });
  console.log(o.a);
  target.dispatchEvent(new Event("e"));
  console.log(o.a, o.isTrusted);
}
main();
