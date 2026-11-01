// Function objects that capture nothing are only called where they are made, once everything between is copied into the caller. Others of the same functions get names of their own, and each frame shows the name of its function object.
// Flags: --aot-check=verify-each-pass
let total = 0;
let shown = "";
function nameInFrame() {
  return new Error("x").stack.split("\n")[2].trim().split(" ")[1];
}
function handOn(list, name, callback) {
  return list[name](callback);
}
function rename(made, name) {
  return Object.defineProperty(made, "name", { value: name });
}
function makeFunction() {
  return function add(x) {
    total += x;
    if (x === 2) shown += nameInFrame() + " ";
  };
}

console.log(Function.prototype.call.call(Array.prototype.find, [4, 5, 6], item => item > 4));

function reachesABuiltInUnderAKey() {
  const list = [1, 2, 3];
  Reflect.apply(handOn, null, [
    list,
    "forEach",
    item => {
      function named() {}
      total += item;
    },
  ]);
}
function callsInPlace(list) {
  const add = makeFunction();
  add(list[0]);
  add(list[1]);
}
function callsInALoop(list) {
  const add = makeFunction();
  for (let i = 0; i < list.length; i++) add(list[i]);
}
function callsUnderAnotherName(list, name) {
  const add = rename(makeFunction(), name);
  add(list[0]);
  add(list[1]);
  return add;
}

for (let round = 0; round < 3; round++) {
  reachesABuiltInUnderAKey();
  callsInPlace([1, 2]);
  const kept = callsUnderAnotherName([1, 2], "round" + round);
  callsInALoop([1, 2, 3]);
  Bun.gc(true);
  kept(2);
  console.log(total, shown, kept.name);
  shown = "";
}
