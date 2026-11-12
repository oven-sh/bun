// Prints what the first stack frame calls a new function object over many variables, its name and its own keys: its name is read at a statement that has read many, the object is changed in one of many ways, and it is given a displayName.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
function nameOf(g) {
  return g.name;
}
function add(g) {
  g.added = 1;
  return g.added;
}
function make(n) {
  let a = n + 1,
    b = n + 2,
    c = n + 3,
    d = n + 4,
    e = n + 5,
    f = n + 6,
    g = n + 7,
    h = n + 8;
  return function made() {
    return new Error("x" + (a + b + c + d + e + f + g + h)).stack;
  };
}
function makeArrow(n) {
  let a = n + 1,
    b = n + 2,
    c = n + 3,
    d = n + 4,
    e = n + 5,
    f = n + 6,
    g = n + 7,
    h = n + 8;
  const arrow = () => new Error("x" + (a + b + c + d + e + f + g + h)).stack;
  if (n < 0) handedBack(arrow);
  return arrow;
}
function makeMethod(n) {
  let a = n + 1,
    b = n + 2,
    c = n + 3,
    d = n + 4,
    e = n + 5,
    f = n + 6,
    g = n + 7,
    h = n + 8;
  return {
    method() {
      return new Error("x" + (a + b + c + d + e + f + g + h)).stack;
    },
  }.method;
}
function makeAskingHowItWasCalled(n) {
  return function asking() {
    return new Error("x" + n + typeof new.target).stack;
  };
}
function makeGenerator(n) {
  const generator = function* generated() {
    yield new Error("x" + n).stack;
  };
  return Object.assign(() => generator().next().value, { looked: generator });
}
for (let i = 0; i < 64; i++) {
  nameOf(make(i));
  add(make(i));
  add(makeArrow(i));
}
const display = f => void (handedBack(f).displayName = "displayed");
const steps = {
  "untouched": a => [],
  "read": a => [nameOf(a)],
  "displayed": a => [display(a)],
  "read, displayed": a => [nameOf(a), display(a)],
  "displayed, read": a => [display(a), nameOf(a)],
  "read, a property added, displayed": a => [nameOf(a), add(a), display(a)],
  "a property added, displayed": a => [add(a), display(a)],
  "a property added, read, displayed": a => [add(a), nameOf(a), display(a)],
  "read, an object created below, displayed": a => [nameOf(a), typeof Object.create(a), display(a)],
  "an object created below, displayed": a => [typeof Object.create(a), display(a)],
  "an object created below, read, displayed": a => [typeof Object.create(a), nameOf(a), display(a)],
  "read, an object linked below, displayed": a => [nameOf(a), typeof Object.setPrototypeOf({}, a), display(a)],
  "read, a literal below, displayed": a => [nameOf(a), typeof { __proto__: a }, display(a)],
  "read through an object below, displayed": a => [nameOf(Object.create(a)), display(a)],
  "read, given a stack, displayed": a => [nameOf(a), typeof Error.captureStackTrace(a), display(a)],
  "given a stack, displayed": a => [typeof Error.captureStackTrace(a), display(a)],
  "read, linked elsewhere, displayed": a => [nameOf(a), typeof Object.setPrototypeOf(a, null), display(a)],
  "read, sealed, displayed": a => [
    nameOf(a),
    Object.isSealed(Object.seal(a)),
    Reflect.set(handedBack(a), "displayName", "displayed"),
  ],
  "read, an element stored, displayed": a => [nameOf(a), (a[0] = 1), display(a)],
  "read, a getter under an index, displayed": a => [
    nameOf(a),
    typeof Object.defineProperty(a, 0, { get: () => 1, configurable: true }),
    display(a),
  ],
  "a getter under an index, displayed": a => [
    typeof Object.defineProperty(a, 0, { get: () => 1, configurable: true }),
    display(a),
  ],
  "read, a symbol stored, displayed": a => [nameOf(a), typeof (a[Symbol.iterator] = 1), display(a)],
  "read, length read, displayed": a => [nameOf(a), a.length, display(a)],
  "read, prototype read, displayed": a => [nameOf(a), typeof a.prototype, display(a)],
  "read, bound, displayed": a => [nameOf(a), nameOf(a.bind(null)), display(a)],
  "bound, displayed": a => [typeof a.bind(null), display(a)],
  "read, printed, displayed": a => [nameOf(a), String(a).length > 0, display(a)],
  "read, deleted, displayed": a => [nameOf(a), delete a.name, display(a)],
  "deleted, displayed": a => [delete a.name, display(a)],
  "read, a property added, deleted, displayed": a => [nameOf(a), add(a), delete a.name, display(a)],
  "read, renamed, displayed": a => [
    nameOf(a),
    typeof Object.defineProperty(a, "name", { value: "renamed" }),
    display(a),
  ],
  "read, named nothing, displayed": a => [
    nameOf(a),
    typeof Object.defineProperty(a, "name", { value: "" }),
    display(a),
  ],
  "read, stated again, displayed": a => [
    nameOf(a),
    typeof Object.defineProperty(a, "name", { value: nameOf(a) }),
    display(a),
  ],
  "asked whether it has one, displayed": a => [Object.hasOwn(a, "name"), display(a)],
  "described, displayed": a => [typeof Object.getOwnPropertyDescriptor(a, "name"), display(a)],
  "listed, displayed": a => [Reflect.ownKeys(a).length > 0, display(a)],
  "read, displayName defined": a => [
    nameOf(a),
    Object.defineProperty(handedBack(a), "displayName", { value: "displayed" }) === a,
  ],
  "read, displayName assigned": a => [nameOf(a), Object.assign(handedBack(a), { displayName: "displayed" }) === a],
  "read, displayed, displayName deleted": a => [nameOf(a), display(a), delete a.displayName],
};
for (const maker of [make, makeArrow, makeMethod, makeAskingHowItWasCalled, makeGenerator]) {
  for (const [step, run] of Object.entries(steps)) {
    for (let round = 0; round < 3; round++) {
      const called = maker(round);
      const a = called.looked ?? called;
      const said = run(a);
      if (round === 2)
        console.log(
          maker.name +
            ", " +
            step +
            ": " +
            [said.join(" "), firstFrame(called()), nameOf(a), Reflect.ownKeys(a).map(String).join()].join(" | "),
        );
    }
  }
}
const one = make(7);
const another = make(8);
nameOf(one);
display(one);
display(another);
console.log("one of two was read: " + [firstFrame(one()), firstFrame(another())].join(" | "));
function once() {
  return new Error("x").stack;
}
once.added = 1;
nameOf(once);
display(once);
console.log("made once, read, displayed: " + firstFrame(once()));
function onceMore() {
  return new Error("x").stack;
}
onceMore.added = 1;
display(onceMore);
console.log("made once, displayed: " + firstFrame(onceMore()));
