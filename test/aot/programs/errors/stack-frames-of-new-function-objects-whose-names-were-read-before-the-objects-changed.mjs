// Prints what the first stack frame calls a new function object, its name and its own keys: its name is read, the object is changed in one of many ways, and it is given a displayName.
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
for (let i = 0; i < 64; i++) nameOf(() => i);
const make = n =>
  function made() {
    return new Error("x" + n).stack;
  };
const display = f => void (handedBack(f).displayName = "displayed");
const steps = {
  "read, an object created below, displayed": a => [nameOf(a), typeof Object.create(a), display(a)],
  "an object created below, displayed": a => [typeof Object.create(a), display(a)],
  "an object created below, read, displayed": a => [typeof Object.create(a), nameOf(a), display(a)],
  "read, an object linked below, displayed": a => [nameOf(a), typeof Object.setPrototypeOf({}, a), display(a)],
  "read, a literal below, displayed": a => [nameOf(a), typeof { __proto__: a }, display(a)],
  "read, a class below, displayed": a => [nameOf(a), typeof class extends a {}, display(a)],
  "read through an object below, displayed": a => [nameOf(Object.create(a)), display(a)],
  "read, constructed, displayed": a => [nameOf(a), typeof new a(), display(a)],
  "read, sealed, displayed": a => [
    nameOf(a),
    Object.isSealed(Object.seal(a)),
    Reflect.set(handedBack(a), "displayName", "displayed"),
  ],
  "read, kept from growing, displayed": a => [
    nameOf(a),
    Object.isExtensible(Object.preventExtensions(a)),
    Reflect.set(handedBack(a), "displayName", "displayed"),
  ],
  "read, an element stored, displayed": a => [nameOf(a), (a[0] = 1), display(a)],
  "read, a symbol stored, displayed": a => [nameOf(a), typeof (a[Symbol.iterator] = 1), display(a)],
  "read, copied from, displayed": a => [nameOf(a), Object.keys({ ...a }).length, display(a)],
  "read, walked, displayed": a => {
    let count = 0;
    nameOf(a);
    for (const key in a) count++;
    return [count, display(a)];
  },
  "walked, displayed": a => {
    let count = 0;
    for (const key in a) count++;
    return [count, display(a)];
  },
  "copied from, displayed": a => [Object.keys({ ...a }).length, display(a)],
  "read, printed, displayed": a => [nameOf(a), String(a).length > 0, display(a)],
  "read, displayName defined": a => [
    nameOf(a),
    Object.defineProperty(handedBack(a), "displayName", { value: "displayed" }) === a,
  ],
  "displayName defined": a => [Object.defineProperty(handedBack(a), "displayName", { value: "displayed" }) === a],
  "read, displayName assigned": a => [nameOf(a), Object.assign(handedBack(a), { displayName: "displayed" }) === a],
  "displayName assigned": a => [Object.assign(handedBack(a), { displayName: "displayed" }) === a],
};
for (const [step, run] of Object.entries(steps)) {
  for (let round = 0; round < 3; round++) {
    const a = make(1);
    const said = run(a);
    if (round === 2)
      console.log(
        step + ": " + [said.join(" "), firstFrame(a()), nameOf(a), Reflect.ownKeys(a).map(String).join()].join(" | "),
      );
  }
}
