// An object literal with fields, a class instance and an empty literal inside a constant literal each get hundreds of computed keys: reads, stores, `in`, hasOwnProperty, delete and key lists answer as for any object, and the fields keep their values.
const hasOwn = Object.prototype.hasOwnProperty;
const size = JSON.parse("300");

class Registry {
  constructor(label) {
    this.label = label;
    this.added = 0;
  }
  add(name, value) {
    if (!hasOwn.call(this, name)) this.added++;
    this[name] = value;
  }
}

function createTally() {
  return { total: 0, label: "tally" };
}
function createState() {
  return { byName: {}, order: [], version: 1 };
}

function fill(table, count, scale) {
  for (let i = 0; i < count; i++) table["key" + i] = i * scale;
}
function countTwice(table, names) {
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (hasOwn.call(table, name)) table[name]++;
      else table[name] = 1;
    }
  }
}
function sum(table, count) {
  let result = 0;
  for (let i = 0; i < count; i++) {
    const value = table["key" + i];
    result += value === undefined ? -1 : value;
  }
  return result;
}
function present(table, count) {
  let own = 0, anywhere = 0;
  for (let i = 0; i < count; i++) {
    if (hasOwn.call(table, "key" + i)) own++;
    if ("key" + i in table) anywhere++;
  }
  return own + " own, " + anywhere + " in";
}
function inherited(table) {
  const names = ["toString", "hasOwnProperty", "constructor", "valueOf", "nothing"];
  return names.map(name => (name in table ? "in" : "out") + "/" + (hasOwn.call(table, name) ? "own" : "not own") + "/" + typeof table[name]).join(" ");
}
function removeEvery(table, step, count) {
  let removed = 0;
  for (let i = 0; i < count; i += step) if (delete table["key" + i]) removed++;
  return removed;
}
function keys(table) {
  const list = Object.keys(table);
  let listed = 0;
  for (const key in table) listed++;
  return list.length + " keys, " + listed + " in for-in, first " + list.slice(0, 3).join(",") + ", last " + list[list.length - 1];
}
function describe(what, table) {
  console.log(what + ": sum " + sum(table, size + 5) + ", " + present(table, size + 5) + ", " + keys(table));
  console.log(what + ": " + inherited(table));
}

function exercise(what, table, fields) {
  fill(table, size, 2);
  describe(what + " filled", table);
  console.log(what + " fields: " + fields());
  fill(table, size, 3);
  describe(what + " replaced", table);
  table["late" + size] = "late";
  console.log(what + " late: " + table["late" + size] + " " + hasOwn.call(table, "late" + size) + " " + Object.keys(table).length);
  console.log(what + " removed: " + removeEvery(table, 3, size));
  describe(what + " after deletes", table);
  fill(table, size, 5);
  describe(what + " filled again", table);
  table["toString"] = 1;
  console.log(what + ": " + inherited(table));
  console.log(what + " fields: " + fields());
}

const tally = createTally();
exercise("literal", tally, () => tally.total + " " + tally.label);
tally.total += 7;
console.log(tally.total, tally["to" + "tal"], hasOwn.call(tally, "total"), delete tally["total"], tally.total, "total" in tally);

const registry = new Registry("registry");
exercise("instance", registry, () => registry.label + " " + registry.added);
for (let i = 0; i < size + 10; i++) registry.add("key" + i, i);
console.log(registry.added, registry.label, registry instanceof Registry, Object.keys(registry).length);

const state = createState();
exercise("nested", state.byName, () => state.version + " " + state.order.length);
console.log(Object.keys(createState().byName).length, Object.keys(state).join(","));

const words = [];
for (let i = 0; i < 400; i++) words.push("w" + ((i * 7) % 150));
const counts = createTally();
countTwice(counts, words);
console.log(Object.keys(counts).length, counts.w0, counts.w149, counts.total, counts.label);

const first = createTally(), second = createTally();
fill(first, size, 1);
fill(second, size, 10);
second["only" + size] = true;
console.log(sum(first, size), sum(second, size), hasOwn.call(first, "only" + size), hasOwn.call(second, "only" + size), first["only" + size], second["only" + size]);

const left = new Registry("left"), right = new Registry("right");
fill(left, size, 1);
fill(right, size, 1);
console.log(left["sha" + "red"], "shared" in left, hasOwn.call(left, "shared"));
Registry.prototype.shared = "shared";
console.log(left["sha" + "red"], "shared" in left, hasOwn.call(left, "shared"));
left["sha" + "red"] = "own";
console.log(left.shared, right.shared, hasOwn.call(left, "shared"), hasOwn.call(right, "shared"));
delete Registry.prototype.shared;
console.log(left.shared, right["sha" + "red"], "shared" in right);
