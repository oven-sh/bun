// A store through a proxy without traps onto a built-in object is refused in the same way every time: what the proxy has remembered of its handler changes nothing. The handlers come out of JSON.parse, so they are no objects of the compiled program.
function replaced() {
  return "replaced";
}
function outcomeOf(store) {
  try {
    store();
    return Math.floor === replaced ? "stored" : "ignored";
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}
const handler = JSON.parse("{}");
const proxy = new Proxy(Math, handler);
const store = function () {
  proxy.floor = replaced;
};
console.log("three stores:", outcomeOf(store), outcomeOf(store), outcomeOf(store));
const asked = new Proxy(Math, JSON.parse("{}"));
Reflect.getOwnPropertyDescriptor(asked, "none");
Reflect.defineProperty(asked, "none", { value: 1, configurable: true });
console.log(
  "after the proxy was asked for its traps:",
  outcomeOf(function () {
    asked.floor = replaced;
  }),
);
handler.unrelated = 1;
console.log("after the handler changed:", outcomeOf(store), outcomeOf(store));
console.log(
  "Reflect.set:",
  Reflect.set(proxy, "floor", replaced),
  Reflect.set(proxy, "floor", replaced),
  Reflect.set({}, "floor", replaced, new Proxy(Math, JSON.parse("{}"))),
);
console.log("Math.floor(1.5):", Math.floor(1.5));
/* Output:
three stores: ignored ignored ignored
after the proxy was asked for its traps: ignored
after the handler changed: ignored ignored
Reflect.set: false false false
Math.floor(1.5): 1
*/
