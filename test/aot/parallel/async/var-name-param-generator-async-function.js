// Prints what a `var` with the name of a parameter holds in generators, in an async function and in a function, where a closure among the defaults reads or stores to the parameter. Plain Bun prints another output.
function* storedInside(
  v = 1,
  store = x => {
    v = x;
  },
) {
  var v;
  store(5);
  yield v;
}
console.log("a generator, stored to inside:", storedInside().next().value);

function* storedWhileSuspended(
  v = 1,
  store = x => {
    v = x;
  },
) {
  var v;
  yield store;
  yield v;
}
const steps = storedWhileSuspended();
steps.next().value(5);
console.log("a generator, stored to while it is suspended:", steps.next().value);

function* read(v = 1, read = () => v) {
  var v = 2;
  yield [v, read()].join();
}
console.log("a generator, read:", read().next().value);

function plain(
  v = 1,
  store = x => {
    v = x;
  },
) {
  var v;
  store(5);
  return v;
}
console.log("a function:", plain());

let held;
async function waits(
  v = 1,
  store = x => {
    v = x;
  },
) {
  var v;
  held = store;
  const read = () => v;
  await null;
  return read();
}
const later = waits();
held(5);
later.then(answer => console.log("an async function, stored to while it waits:", answer));
/* Output:
a generator, stored to inside: 1
a generator, stored to while it is suspended: 1
a generator, read: 2,1
a function: 1
an async function, stored to while it waits: 1
*/
