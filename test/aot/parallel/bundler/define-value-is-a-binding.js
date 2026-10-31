// A `--define` whose value is one name is that name where the defined name is written: a binding that is in scope there is read, stored to and called, and where none is in scope the global of the name is.
// Flags: --define NAME=target --define OWN=own --define COUNT=count --define MAKE=make --define KIND=Kind --define process.env.ALIAS=holder
// Env: ALIAS=from the environment
globalThis.target = "the global";
globalThis.own = "the global";
globalThis.count = "the global";
globalThis.holder = "the global";

function declares() {
  const target = "the binding of the function";
  return NAME;
}
function takes(target) {
  return [NAME, typeof NAME, JSON.stringify({ NAME })].join();
}
function takesBesideADefault(target, seen = NAME) {
  return seen;
}
function declaresInItsBody(seen = NAME) {
  var target = "the variable of the body";
  return seen + ", " + NAME;
}
function catches() {
  try {
    throw "the parameter of the catch clause";
  } catch (target) {
    return NAME;
  }
}
const named = function target() {
  return typeof NAME;
};
const Named = class target {
  static read() {
    return typeof NAME;
  }
};
function hoists() {
  const seen = NAME;
  if (seen === undefined) {
    var target = "stored in the block";
  }
  return seen + ", " + NAME;
}

console.log(declares(), NAME);
console.log(takes("the parameter"), NAME);
console.log(takesBesideADefault("the parameter beside the default"), declaresInItsBody());
console.log(catches(), named(), Named.read(), hoists());
console.log(NAME, typeof NAME, JSON.stringify({ NAME }));

let own = "the binding of the file";
let count = 0;
function make() {
  return "made by the function of the file";
}
class Kind {}

console.log(OWN, typeof OWN, JSON.stringify({ OWN }), MAKE(), new KIND() instanceof Kind);
OWN = "stored";
COUNT += 2;
COUNT++;
console.log(own, count, globalThis.own, globalThis.count);

function bump() {
  return ++COUNT;
}
console.log(bump(), bump(), count);

[OWN, COUNT] = ["from an array", 10];
({ a: OWN, COUNT } = { a: "from an object", COUNT: 20 });
console.log(own, count);
for (COUNT of [30, 40]);
for (OWN in { key: 0 });
console.log(own, count, COUNT in { 40: 0 }, globalThis.own, globalThis.count);

class Reader {
  field = OWN;
  static seen = COUNT;
}
console.log(new Reader().field, Reader.seen);

const holder = "the binding of the file";
console.log(process.env.ALIAS, typeof process.env.ALIAS);
process.env.ALIAS = "stored";
console.log(process.env.ALIAS, Reflect.get(process.env, "ALIAS"), globalThis.holder);
