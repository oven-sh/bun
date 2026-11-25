// Every attribute that a written descriptor gives or leaves out shows in the created object as the built-in would set it, and the keys keep the built-in's order.
// STATISTIC: ObjectCreateDescriptorsExpanded >= 4
const first = Symbol("first");
const second = Symbol("second");
const seen = [];
const show = object => Reflect.ownKeys(object).map(key => String(key) + ":" + JSON.stringify(Object.getOwnPropertyDescriptor(object, key), (name, value) => (typeof value === "function" ? "function " + value.name : value === undefined ? "undefined" : value))).join(" ");
function symbols(a, b) {
  return Object.create(null, {
    [second]: { value: a, writable: true, enumerable: true, configurable: true },
    [first]: { value: b, writable: false, enumerable: false, configurable: false },
  });
}
function accessors(state) {
  return Object.create(Object.prototype, {
    [first]: { get() { return state.value; }, set(value) { state.value = value; }, enumerable: true },
    [second]: { get: undefined, configurable: true },
  });
}
function empty(prototype) {
  return Object.create(prototype, { [first]: {} });
}
function order(log) {
  return Object.create((log.push("prototype"), null), { [(log.push("key one"), first)]: { value: (log.push("value one"), 1) }, [(log.push("key two"), second)]: { value: (log.push("value two"), 2) } });
}
seen.push(show(symbols(1, "two")), show(symbols(undefined, null)), show(symbols({ toJSON() { return "object"; } }, [1, 2])));
const state = { value: 1 };
const withAccessors = accessors(state);
withAccessors[first] = 7;
seen.push(show(withAccessors), String(withAccessors[first]), String(state.value), String(withAccessors[second]));
seen.push(show(empty(null)), show(empty(Array.prototype)), String(Array.isArray(empty(Array.prototype))));
const log = [];
seen.push(show(order(log)), log.join());
function tryTo(run) { try { return String(run()); } catch (error) { return error.constructor.name + ": " + error.message; } }
for (const prototype of [undefined, 1, "text", true, Symbol.iterator]) seen.push(tryTo(() => show(empty(prototype))));
for (const prototype of [null, {}, function named() {}, new Map(), Object.create(null)]) seen.push(tryTo(() => show(empty(prototype)) + " " + (Object.getPrototypeOf(empty(prototype)) === prototype)));
console.log(seen.join("\n"));
