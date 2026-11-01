// A heap snapshot shows what a variable of a function holds for its closures under the variable's name, whether the function runs once or often and whether the variable is assigned again or not.
const readers = [];
const isNeverSet = process.argv.length > 99;

class HeldOnce {}
function runsOnce() {
  const heldOnce = new HeldOnce();
  return () => heldOnce;
}
readers.push(runsOnce());

class AssignedOnce {}
function runsOnceAndAssigns() {
  let assignedOnce = new AssignedOnce();
  return [() => assignedOnce, value => (assignedOnce = value)];
}
const [readAssignedOnce, assignOnce] = runsOnceAndAssigns();
if (isNeverSet) assignOnce(1);
readers.push(readAssignedOnce);

class HeldOften {}
class AssignedOften {}
for (let i = 0; i < 3; i++) {
  const heldOften = new HeldOften();
  let assignedOften = new AssignedOften();
  readers.push(() => heldOften, () => assignedOften);
  if (isNeverSet) readers.push(value => (assignedOften = value));
}

class Parameter {}
function takes(parameter) {
  return () => parameter;
}
readers.push(takes(new Parameter()));

class Default {}
function fillsIn(byDefault = new Default()) {
  return () => byDefault;
}
readers.push(fillsIn());

class Caught {}
function catches() {
  try {
    throw new Caught();
  } catch (caught) {
    return () => caught;
  }
}
readers.push(catches());

class TwoFunctionsUp {}
function outer() {
  const twoFunctionsUp = new TwoFunctionsUp();
  return function middle() {
    return () => twoFunctionsUp;
  };
}
readers.push(outer()());

class InMethod {}
class Maker {
  make() {
    const inMethod = new InMethod();
    return () => inMethod;
  }
}
readers.push(new Maker().make());

class AcrossAwait {}
async function waits() {
  const acrossAwait = new AcrossAwait();
  readers.push(() => acrossAwait);
  await new Promise(() => {});
  return acrossAwait;
}
waits();

class Receiver {
  arrow() {
    return () => this;
  }
}
readers.push(new Receiver().arrow(), new Receiver().arrow());

class SetLate {}
function readsEarly() {
  const read = () => setLate;
  let message;
  try {
    read();
  } catch (error) {
    message = error.message;
  }
  let setLate = new SetLate();
  console.log(message);
  return read;
}
readers.push(readsEarly());

const snapshot = Bun.generateHeapSnapshot();
const classOf = new Map();
const objects = new Map();
for (let i = 0; i < snapshot.nodes.length; i += 4) {
  const name = snapshot.nodeClassNames[snapshot.nodes[i + 2]];
  classOf.set(snapshot.nodes[i], name);
  objects.set(name, (objects.get(name) ?? 0) + 1);
}
const variable = snapshot.edgeTypes.indexOf("Variable");
const names = new Map();
for (let i = 0; i < snapshot.edges.length; i += 4) {
  if (snapshot.edges[i + 2] !== variable) continue;
  const held = classOf.get(snapshot.edges[i + 1]);
  if (!names.has(held)) names.set(held, new Set());
  names.get(held).add(snapshot.edgeNames[snapshot.edges[i + 3]]);
}
for (const held of [
  HeldOnce,
  AssignedOnce,
  HeldOften,
  AssignedOften,
  Parameter,
  Default,
  Caught,
  TwoFunctionsUp,
  InMethod,
  AcrossAwait,
  Receiver,
  SetLate,
])
  console.log(`${objects.get(held.name) ?? 0} ${held.name}: ${[...(names.get(held.name) ?? [])].sort().join(" ") || "no name"}`);
console.log(readers.map(read => read().constructor.name).join(" "));
