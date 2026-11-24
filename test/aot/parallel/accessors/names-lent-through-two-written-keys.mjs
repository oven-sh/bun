// STATISTIC: AccessesDispatchedByKeyString >= 3
// One function lays accessors that read and store through a key that its callers write: two keys, read and stored in loops; the receiver is what they were laid on, or is not.
function lend(on, source, name) {
  Object.defineProperty(on, name, {
    enumerable: true,
    configurable: true,
    get() {
      return this[source][name];
    },
    set(value) {
      this[source][name] = value;
    },
  });
}
class Panel {
  constructor(values, limits) {
    this._values = values;
    this._limits = limits;
    for (const name of Object.keys(values)) lend(this, "_values", name);
    for (const name of Object.keys(limits)) lend(this, "_limits", name);
  }
  share() {
    return this.level / this.most;
  }
}
function fill(panel, turns) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    panel.level = turn & 7;
    sum += panel.level * panel.step + panel.most;
    if (panel.level > panel.most) panel.most += 1;
  }
  return sum;
}
function names(panel, turns) {
  let size = 0;
  for (let turn = 0; turn < turns; turn++) size += panel.label.length + panel.unit.length;
  return size;
}
const make = k => new Panel({ level: k, label: "panel" + k, step: 2 + k }, { most: 5, unit: "cm" });
const first = make(1), second = make(3);
let total = 0;
for (let turn = 0; turn < 40; turn++) total += fill(first, 20) + fill(second, 9) + names(first, 12) + names(second, 5) + first.share();
console.log(total.toFixed(6), first._limits.most, second._values.level, Object.keys(first).join());
const below = Object.create(first);
below.level = 99;
console.log(first.level, Object.hasOwn(below, "level"), fill(below, 3), names(below, 2));
below._values = { level: 1, label: "own", step: 10 };
console.log(fill(below, 3), first.level, names(below, 1), below.share());
const getter = Object.getOwnPropertyDescriptor(first, "label").get;
console.log(getter.call(second), getter.call({ _values: { label: "apart" } }));
for (const odd of [{}, null, 5]) {
  try { console.log(getter.call(odd)); } catch (error) { console.log(error.constructor.name); }
}
first._values = Object.freeze({ level: 2, label: "frozen", step: 1 });
try { fill(first, 2); } catch (error) { console.log(error.constructor.name, first.level, names(first, 2)); }
delete second.label;
second.label = "plain now";
Object.defineProperty(second, "unit", { get: () => "m" });
console.log(names(second, 3), second._values.label);
