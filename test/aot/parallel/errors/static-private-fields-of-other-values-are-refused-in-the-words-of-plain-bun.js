// A static private field that is read from or stored to anything but its class is refused in plain Bun's words: the access is quoted, and undefined and null are no objects.
function tell(label, run) {
  try {
    run();
    console.log(label + ": nothing thrown");
  } catch (error) {
    console.log(label + ": " + error.constructor.name + ": " + error.message + " | " + error.stack.split("\n").slice(1, 3).map(line => /:(\d+:\d+)\)?$/.exec(line)?.[1]).join(" < "));
  }
}
class S {
  static #s = 1;
  static #m() { return 1; }
  static get #g() { return 1; }
  static set #g(v) {}
  static read(o) { return o.first.#s; }
  static store(o) { o.first.#s = 2; }
  static update(o) { o.first.#s++; }
  static add(o) { o.first.#s += 1; }
  static call(o) { return o.first.#m(); }
  static getter(o) { return o.first.#g; }
  static setter(o) { o.first.#g = 1; }
  static readOverLines(o) {
    return o
      .first
      .#s;
  }
  static storeOverLines(o) {
    o
      .first
      .#s = 2;
  }
  static readDirect(o) { return o.#s; }
}
for (const [kind, first] of [["another object", {}], ["nothing", undefined], ["a number", 1], ["a function", () => {}]]) {
  tell("read of " + kind, () => S.read({ first }));
  tell("store to " + kind, () => S.store({ first }));
  tell("update of " + kind, () => S.update({ first }));
  tell("add to " + kind, () => S.add({ first }));
  tell("call on " + kind, () => S.call({ first }));
  tell("getter of " + kind, () => S.getter({ first }));
  tell("setter of " + kind, () => S.setter({ first }));
  tell("read over lines of " + kind, () => S.readOverLines({ first }));
  tell("store over lines to " + kind, () => S.storeOverLines({ first }));
  tell("read direct of " + kind, () => S.readDirect(first));
}
tell("read of null", () => S.read({ first: null }));
tell("read from a subclass", () => S.readDirect(class extends S {}));
