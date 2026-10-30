// A function first takes a value that the compiler does not follow, hands what it takes to an event, and reads it under a computed key. Later `process` reaches the same function behind ten calls.
const hide = value => new CustomEvent("x", { detail: value }).detail;
function read(object, key) {
  hide(object);
  return object[key];
}
function list(object) {
  hide(object);
  const kinds = [];
  for (const key in object) if (/^(std|final|allowedNode)/.test(key)) kinds.push(key + " " + typeof object[key]);
  return kinds.join();
}
function copy(object) {
  hide([object]);
  return { ...object };
}
read(hide({ a: 1 }), "a");
list(hide({ a: 1 }));
copy(hide({ a: 1 }));
const z0 = { get: () => process };
const z1 = { get: () => z0.get() };
const z2 = { get: () => z1.get() };
const z3 = { get: () => z2.get() };
const z4 = { get: () => z3.get() };
const z5 = { get: () => z4.get() };
const z6 = { get: () => z5.get() };
const z7 = { get: () => z6.get() };
const z8 = { get: () => z7.get() };
const z9 = { get: () => z8.get() };
const found = read(z9.get(), hide("allowedNodeEnvironmentFlags"));
console.log(typeof found, Object.prototype.toString.call(found), found.size > 0);
for (const name of ["version", "nextTick", "stdout", "stderr", "stdin", "config", "report", "finalization"])
  console.log(name, typeof read(z9.get(), hide(name)));
console.log(typeof read(z9.get(), hide("stdout")).write, read(z9.get(), hide("stdout")) === process.stdout);
console.log(list(z9.get()));
console.log(typeof copy(z9.get()).stdout.write, typeof copy(z9.get()).finalization.register);
