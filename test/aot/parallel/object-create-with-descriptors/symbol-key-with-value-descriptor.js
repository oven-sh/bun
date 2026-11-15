// Object.create(null, { [symbol]: { value } }) with both literals written out: the object is created and the property defined, and neither literal is allocated.
// STATISTIC: ObjectCreateDescriptorsExpanded >= 3
const EntitiesKey = Symbol("Entities");
class Tracker {
  constructor() {
    this.paths = Object.create(null, { [EntitiesKey]: { value: new Set() } });
  }
  entities(path) {
    let current = this.paths;
    for (const segment of path) current = current[segment] ||= Object.create(null, { [EntitiesKey]: { value: new Set() } });
    return current[EntitiesKey];
  }
}
const seen = [];
const show = object => Reflect.ownKeys(object).map(key => String(key) + ":" + JSON.stringify(Object.getOwnPropertyDescriptor(object, key), (name, value) => (value instanceof Set ? "Set(" + [...value] + ")" : value))).join(" ");
const tracker = new Tracker();
tracker.entities(["a", "b"]).add(1);
tracker.entities(["a"]).add(2);
tracker.entities(["a", "b"]).add(3);
tracker.entities([]).add(4);
seen.push(show(tracker.paths), show(tracker.paths.a), show(tracker.paths.a.b), String(Object.getPrototypeOf(tracker.paths)), String(Object.keys(tracker.paths)));
seen.push(String(new Tracker().paths[EntitiesKey] === new Tracker().paths[EntitiesKey]), String(Object.isExtensible(tracker.paths)));
"use strict";
function tryTo(run) { try { return String(run()); } catch (error) { return error.constructor.name + ": " + error.message; } }
seen.push(tryTo(() => { "use strict"; tracker.paths[EntitiesKey] = 1; }), tryTo(() => { "use strict"; return delete tracker.paths[EntitiesKey]; }), tryTo(() => Object.defineProperty(tracker.paths, EntitiesKey, { value: 2 })));
const prototype = { inherited: "yes" };
const below = Object.create(prototype, { [Symbol.toStringTag]: { value: "Below" }, [EntitiesKey]: { value: 5, enumerable: true } });
seen.push(show(below), below.inherited, Object.prototype.toString.call(below), String(Object.getPrototypeOf(below) === prototype));
let total = 0;
for (let i = 0; i < 20000; i++) { const each = new Tracker(); each.entities(["x"]).add(i); total += each.paths.x[EntitiesKey].size + each.paths[EntitiesKey].size; }
seen.push(String(total));
console.log(seen.join("\n"));
