// `name` and `length` of a function are not writable: in sloppy code a store is silent. `prototype` is writable on a function and not on a class.
const log = [];
const Kind = { tag: "kind" };
function store(target, key, value) { target[key] = value; return target[key]; }
function attempt(label, store, target, key, value) {
  try { log.push(label + " " + key + " " + String(store(target, key, value)) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(target, key))); }
  catch (error) { log.push(label + " " + key + " " + error.name); }
}
for (let round = 0; round < 3; round++) {
  for (const below of [false, true]) {
    const makers = [() => function plain(a, b) {}, () => class Klass { constructor(a) {} }, () => (a) => a, () => async function later() {}, () => function* steps() {}, () => ({ method(a, b, c) {} }).method];
    for (const maker of makers) {
      for (const key of ["name", "length", "prototype"]) {
        const made = maker();
        if (below) Object.setPrototypeOf(made, Kind);
        attempt((below ? "below " : "") + round, store, made, key, "new");
      }
    }
  }
}
console.log(log.join("\n"));
