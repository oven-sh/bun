// RUN: lower
// OPTIONS: builtin-modules

// Iterator helpers hand on their objects.
const id = x => x;
const c = { n: 21 };
const out = [c].values().map(id).toArray()[0];
console.log(typeof out, out === c);
const kept = [c].values().filter(() => true).next().value;
console.log(typeof kept, kept === c);

// CHECK-LABEL: function {{*}}name="id"
