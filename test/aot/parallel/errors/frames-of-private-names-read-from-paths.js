// The frame of a function that reads, stores, updates or calls a private name stands where it does for any other member: behind what the name is read from. The call of a private accessor stands where the access begins.
function tell(label, run) {
  try {
    run();
    console.log(label + ": nothing thrown");
  } catch (error) {
    console.log(label + ": " + error.constructor.name + ": " + error.message + " | " + error.stack.split("\n").slice(1, 3).map(line => /:(\d+:\d+)\)?$/.exec(line)?.[1]).join(" < "));
  }
}
class Fields {
  #x = 1;
  #m() { return 1; }
  static read(o) { return o.first.#x; }
  static readDirect(o) { return o.#x; }
  static readDeep(o) { return o.first.second.#x; }
  static readOverLines(o) {
    return o
      .first
      .#x;
  }
  static store(o) { o.first.#x = 2; }
  static update(o) { o.first.#x++; }
  static call(o) { return o.first.#m(); }
  static readOfCall(o) { return o.make().#x; }
  static readOfElement(o, k) { return o.list[k].#x; }
  static wrongObject(o) { return o.first.#x; }
  static has(o) { return #x in o.first; }
}
tell("read", () => Fields.read({}));
tell("read direct", () => Fields.readDirect(undefined));
tell("read deep", () => Fields.readDeep({ first: {} }));
tell("read over lines", () => Fields.readOverLines({}));
tell("store", () => Fields.store({}));
tell("update", () => Fields.update({}));
tell("call", () => Fields.call({}));
tell("read of a call", () => Fields.readOfCall({ make() {} }));
tell("read of an element", () => Fields.readOfElement({ list: [] }, 0));
tell("an object without the name", () => Fields.wrongObject({ first: {} }));
tell("in", () => Fields.has({}));
class P {
  #x = 1;
  #inner;
  get #g() { throw new Error("from the getter"); }
  set #g(v) { throw new Error("from the setter"); }
  #m() { throw new Error("from the method"); }
  constructor(inner) { this.#inner = inner; }
  static getter(o) { return o.first.#g; }
  static setter(o) { o.first.#g = 1; }
  static method(o) { return o.first.#m(); }
  static twice(o) { return o.#inner.#inner.#x; }
  static twiceOverLines(o) {
    return o
      .#inner
      .#inner
      .#x;
  }
  static add(o) { o.first.#x += 2; }
  static logical(o) { o.first.#x ??= 2; }
  static optional(o) { return o?.first.#x; }
  own() { return this.#inner.#x; }
  static template(o) { return `${o.first.#x}`; }
  static argument(f, o) { return f(o.first.#x); }
  static destructured(o) { const { a } = o.first.#inner; return a; }
}
const holder = { first: new P() };
tell("getter", () => P.getter(holder));
tell("setter", () => P.setter(holder));
tell("method", () => P.method(holder));
tell("twice, the second", () => P.twice(new P()));
tell("twice, the third", () => P.twice(new P(new P())));
tell("twice over lines, the second", () => P.twiceOverLines(new P()));
tell("twice over lines, the third", () => P.twiceOverLines(new P(new P())));
tell("add", () => P.add({}));
tell("logical", () => P.logical({}));
tell("optional", () => P.optional({}));
tell("own", () => new P().own());
tell("template", () => P.template({}));
tell("argument", () => P.argument(v => v, {}));
tell("destructured", () => P.destructured(holder));
class Q {
  #v = 1;
  get #g() { return this.#v; }
  set #g(v) { this.#v = v; }
  get #thrower() { throw new Error("from the getter"); }
  set #thrower(v) { throw new Error("from the setter"); }
  get #onlyGetter() { return 1; }
  set #onlySetter(v) {}
  #m() { return 1; }
  static getterOfNothing(o) { return o.first.#g; }
  static setterOfNothing(o) { o.first.#g = 1; }
  static methodOfNothing(o) { return o.first.#m(); }
  static getterOfOther(o) { return o.first.#g; }
  static setterOfOther(o) { o.first.#g = 1; }
  static methodOfOther(o) { return o.first.#m(); }
  static addThroughThrower(o) { o.first.#thrower += 1; }
  static incrementThroughThrower(o) { o.first.#thrower++; }
  static storeToGetter(o) { o.first.#onlyGetter = 1; }
  static readOfSetter(o) { return o.first.#onlySetter; }
  static storeToMethod(o) { o.first.#m = 1; }
  static getterOverLines(o) {
    return o
      .first
      .#thrower;
  }
  static setterOverLines(o) {
    o
      .first
      .#thrower = 1;
  }
}
const q = { first: new Q() };
tell("getter of nothing", () => Q.getterOfNothing({}));
tell("setter of nothing", () => Q.setterOfNothing({}));
tell("method of nothing", () => Q.methodOfNothing({}));
tell("getter of another object", () => Q.getterOfOther({ first: {} }));
tell("setter of another object", () => Q.setterOfOther({ first: {} }));
tell("method of another object", () => Q.methodOfOther({ first: {} }));
tell("add through an accessor", () => Q.addThroughThrower(q));
tell("increment through an accessor", () => Q.incrementThroughThrower(q));
tell("store to a getter", () => Q.storeToGetter(q));
tell("read of a setter", () => Q.readOfSetter(q));
tell("store to a method", () => Q.storeToMethod(q));
tell("getter over lines", () => Q.getterOverLines(q));
tell("setter over lines", () => Q.setterOverLines(q));
