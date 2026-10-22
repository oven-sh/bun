// A field that left its slot (a value of another type, other attributes, an accessor in its place) is read through the caches like any other property,
// and the caches follow it when it changes there, goes back into its slot or is deleted.
function make(i) { return { a: i, b: i + 1, c: i + 2 }; }
function readB(o) { return o.b; }
function sum(objects) {
  let total = 0;
  for (let round = 0; round < 200; round++) {
    for (const o of objects) {
      const value = readB(o);
      total += typeof value === "number" ? value : String(value).length;
    }
  }
  return total;
}
function three() { return [make(1), make(2), make(3)]; }
const lines = [];
function show(label, objects) { lines.push(label + ": " + sum(objects) + " " + Object.keys(objects[0]).join()); }

const inSlots = three();
show("in slots", inSlots);

const otherType = three();
for (const o of otherType) o.b = "seven";
show("another type", otherType);

const hidden = three();
for (const o of hidden) Object.defineProperty(o, "b", { enumerable: false });
show("not enumerable", hidden);

const readOnly = three();
for (const o of readOnly) Object.defineProperty(o, "b", { value: 9, writable: false });
show("read only", readOnly);

const getters = three();
for (const o of getters) Object.defineProperty(o, "b", { get() { return this.a * 10; }, enumerable: true, configurable: true });
show("getter", getters);

show("all at one site", [inSlots[0], otherType[0], hidden[0], readOnly[0], getters[0]]);

for (const o of hidden) o.b = 42;
show("stored outside the slot", hidden);
for (const o of hidden) o.later = 1;
show("another property beside it", hidden);
for (const o of otherType) o.b = "eleven chars";
show("another type again", otherType);

for (const o of otherType) o.b = 5;
show("fitting value", otherType);
for (const o of hidden) Object.defineProperty(o, "b", { enumerable: true });
show("enumerable again", hidden);
for (const o of getters) Object.defineProperty(o, "b", { value: 3, writable: true });
show("data in place of the getter", getters);

for (const o of readOnly) delete o.b;
show("deleted", readOnly);
for (const o of readOnly) o.b = 8;
show("created again", readOnly);

const one = make(7);
Object.defineProperty(one, "b", { enumerable: false });
show("one of two is outside", [one, make(7)]);
console.log(lines.join("\n"));
