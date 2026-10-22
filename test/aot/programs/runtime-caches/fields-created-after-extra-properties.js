// A field that is created on an object which already has properties under names the compiler never saw:
// the keys keep the order of creation, however many such properties came first, and what was cached about
// the objects below a prototype does not outlive a field that the prototype gets.
const outOfSight = new Proxy({}, {});

function Message(id) {
  this.id = id;
}
outOfSight.value = Message;

function addUnderUnknownNames(message, names) {
  for (const name of names) message[name] = name.length;
}

function finish(message, step) {
  message.status = step;
  if (step % 2) message.body = "b" + step;
  message.done = true;
}

function interleave(message, names, step) {
  message.status = step;
  addUnderUnknownNames(message, names.slice(0, 1));
  message.body = "b";
  addUnderUnknownNames(message, names.slice(1));
  message.done = false;
}

const nameLists = JSON.parse('[[], ["x"], ["x", "y"], ["y", "x", "z"], ["status2", "10", "2", "a"]]');
const seen = new Map();
function note(label, message) {
  const line = label + ": " + Object.keys(message).join(",") + " | " + JSON.stringify(message);
  seen.set(line.replace(/\d+/g, "#"), (seen.get(line.replace(/\d+/g, "#")) ?? 0) + 1);
}

for (let round = 0; round < 200; round++) {
  const names = nameLists[round % nameLists.length];
  const first = new outOfSight.value(round);
  addUnderUnknownNames(first, names);
  finish(first, round);
  note("after", first);

  const second = new outOfSight.value(round);
  interleave(second, names, round);
  note("between", second);

  const third = new outOfSight.value(round);
  finish(third, round);
  addUnderUnknownNames(third, names);
  note("before", third);

  const fourth = new outOfSight.value(round);
  addUnderUnknownNames(fourth, names);
  delete fourth[names[0]];
  finish(fourth, round);
  note("deleted", fourth);
}
for (const [line, count] of [...seen].sort()) console.log(count, line);

function readStatus(object) {
  return object.status;
}
function hasStatus(object) {
  return "status" in object;
}
function storeStatus(object, value) {
  object.status = value;
  return Object.keys(object).join(",");
}

for (const names of nameLists) {
  const base = new outOfSight.value(0);
  addUnderUnknownNames(base, names);
  const derived = Object.create(base);
  const results = [];
  for (let i = 0; i < 30; i++) results.push(readStatus(derived), hasStatus(derived));
  finish(base, 7);
  for (let i = 0; i < 3; i++) results.push(readStatus(derived), hasStatus(derived));
  console.log(names.length, [...new Set(results.map(String))].join(","), results.slice(-2).join(","), Object.keys(base).join(","));

  const withSetter = new outOfSight.value(1);
  addUnderUnknownNames(withSetter, names);
  const below = Object.create(withSetter);
  for (let i = 0; i < 30; i++) storeStatus(Object.create(withSetter), i);
  Object.defineProperty(withSetter, "status", { configurable: true, set(value) { this.stored = value; } });
  console.log(names.length, storeStatus(below, 5), below.stored, readStatus(below));
}
