// new.target is per activation. User code that runs between a construct call and the callee's read of new.target (a
// newTarget.prototype getter, a field initializer, a default parameter, a super() argument) can construct and call other
// functions without changing it. A plain call sees undefined, even right after a construct call that threw.
const log: string[] = [];
const labels = new Map<unknown, string>();
const nameOf = (target: unknown): string => (target === undefined ? "undefined" : labels.get(target) ?? "unlabeled");
const opaque = new Function("value", "return value") as <T>(value: T) => T;
const Probe: any = function (first: any, second: any) {
  log.push("  Probe " + nameOf(new.target) + " " + first + " " + second);
};
function disturb(where: string): string {
  log.push(where);
  new Probe(1, 2);
  Probe(3, 4);
  return where;
}
function section(title: string, run: () => unknown): void {
  log.push("# " + title);
  try {
    run();
  } catch (error: any) {
    log.push("threw " + error.constructor.name + " " + error.message);
  }
}
const Outer: any = function (first: any = disturb("default parameter"), second: any = "second") {
  disturb("body");
  const readLate = () => new.target;
  log.push("Outer " + nameOf(new.target) + " " + first + " " + second);
  disturb("before the arrow function");
  log.push("Outer, in an arrow function " + nameOf(readLate()));
};
class Base {
  field = disturb("field initializer");
  seen: string;
  constructor(first: string = disturb("Base default parameter")) {
    disturb("Base body");
    this.seen = nameOf(new.target) + " " + first;
  }
}
class Derived extends Base {
  late: string;
  constructor() {
    const early = new.target;
    super(disturb("super() argument"));
    disturb("after super");
    this.late = nameOf(early) + " " + nameOf(new.target);
  }
}
const Nest: any = function (depth: number) {
  if (depth > 0) {
    new Nest(depth - 1);
    Nest(-depth);
  }
  log.push("Nest " + depth + " " + nameOf(new.target));
};
const Wide: any = function (a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any) {
  log.push("Wide " + nameOf(new.target) + " " + [a, b, c, d, e, f, g, h, i].map(String).join());
};
class WideClass {
  constructor(a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any) {
    log.push("WideClass " + nameOf(new.target) + " " + [a, b, c, d, e, f, g, h, i].map(String).join());
  }
}
function constructAtEdges(Callee: any): void {
  new Callee(1, 2, 3);
  new Callee(1, 2, 3, 4);
  new Callee(1, 2, 3, 4, 5, 6, 7);
  new Callee(1, 2, 3, 4, 5, 6, 7, 8);
  new Callee(1, 2, 3, 4, 5, 6, 7, 8, 9);
}
function callAtEdges(callee: any): void {
  callee(1, 2, 3);
  callee(1, 2, 3, 4);
  callee(1, 2, 3, 4, 5, 6, 7);
  callee(1, 2, 3, 4, 5, 6, 7, 8);
  callee(1, 2, 3, 4, 5, 6, 7, 8, 9);
}
const Fails: any = function (
  first: any = (() => {
    throw new RangeError("no default");
  })(),
) {
  log.push("not reached " + nameOf(new.target) + first);
};
function bindWithPrototypeGetter(target: any, label: string, getPrototype: () => unknown): any {
  const bound = target.bind(null);
  Object.defineProperty(bound, "prototype", { get: getPrototype });
  labels.set(bound, label);
  return bound;
}
labels
  .set(Probe, "Probe")
  .set(Outer, "Outer")
  .set(Base, "Base")
  .set(Derived, "Derived")
  .set(Nest, "Nest")
  .set(Wide, "Wide")
  .set(WideClass, "WideClass")
  .set(Fails, "Fails");
const boundOuter = bindWithPrototypeGetter(Outer, "bound Outer", () => {
  disturb("prototype getter");
  return Outer.prototype;
});
const boundBase = bindWithPrototypeGetter(Base, "bound Base", () => {
  disturb("prototype getter");
  return Base.prototype;
});
const failing = bindWithPrototypeGetter(Outer, "failing", () => {
  disturb("throwing prototype getter");
  throw new RangeError("no prototype");
});
const proxy: any = new Proxy(Outer, {
  get(target, key, receiver) {
    if (key === "prototype") disturb("get trap");
    return Reflect.get(target, key, receiver);
  },
});
labels.set(proxy, "proxy");
const HiddenOuter = opaque(Outer),
  HiddenBase = opaque(Base),
  HiddenDerived = opaque(Derived),
  HiddenFails = opaque(Fails),
  HiddenProbe = opaque(Probe);
section("construct a function", () => new Outer("a", "b"));
section("construct it with a default parameter", () => new Outer());
section("call it", () => Outer("a", "b"));
section("call it with a default parameter", () => Outer());
section("classes", () => {
  const base = new Base("x"),
    other = new Base(),
    derived = new Derived();
  log.push(base.seen, other.seen, derived.seen, derived.late);
});
section("a subclass as new.target", () => {
  const instance = Reflect.construct(Base, ["x"], Derived);
  log.push(instance.seen, String(instance instanceof Derived), String("late" in instance));
});
for (let round = 0; round < 2; round++) {
  section("new.target with a prototype getter", () => Reflect.construct(Outer, ["a", "b"], boundOuter));
  section("the same for a class", () => log.push(Reflect.construct(Base, ["x"], boundBase).seen));
  section("construct a proxy", () => new proxy("a", "b"));
  section("a proxy as new.target", () => Reflect.construct(Outer, ["a", "b"], proxy));
}
section("construct a bound function", () => new boundOuter("a", "b"));
section("the prototype getter throws", () => Reflect.construct(Outer, ["a", "b"], failing));
section("an indirect call after the prototype getter threw", () => HiddenProbe(5, 6));
section("a direct call after the prototype getter threw", () => Outer("a", "b"));
section("the default parameter throws, direct construct", () => new Fails());
section("an indirect call after the direct construct threw", () => HiddenProbe(5, 6));
section("the default parameter throws, indirect construct", () => new HiddenFails());
section("an indirect call after the indirect construct threw", () => HiddenProbe(5, 6));
section("a direct call after the indirect construct threw", () => Probe(5, 6));
section("indirect, unknown callee", () => {
  new HiddenOuter("a", "b");
  HiddenOuter("c", "d");
  log.push(new HiddenBase("x").seen, new HiddenDerived().late);
});
section("from native code", () => {
  Reflect.construct(Probe, [1, 2]);
  Reflect.apply(Probe, undefined, [3, 4]);
  [5].forEach(Probe);
  Probe.call(undefined, 6, 7);
  Probe.apply(undefined, [8, 9]);
});
section("from interpreted code", () => new Function("F", "new F(1, 2); F(3, 4);")(Probe));
section("nested construct calls of one function", () => new Nest(2));
section("argument counts around the register limit", () => {
  new Wide(1, 2, 3);
  Wide(1, 2, 3);
  new Wide(1, 2, 3, 4);
  Wide(1, 2, 3, 4);
  new Wide(1, 2, 3, 4, 5, 6, 7);
  Wide(1, 2, 3, 4, 5, 6, 7);
  new Wide(1, 2, 3, 4, 5, 6, 7, 8);
  Wide(1, 2, 3, 4, 5, 6, 7, 8);
  new Wide(1, 2, 3, 4, 5, 6, 7, 8, 9);
  Wide(1, 2, 3, 4, 5, 6, 7, 8, 9);
});
section("the same, indirect", () => {
  constructAtEdges(opaque(Wide));
  callAtEdges(opaque(Wide));
  constructAtEdges(opaque(WideClass));
});
section("not constructors", () => {
  for (const callee of [() => 0, async function () {}, { method() {} }.method] as any[]) {
    try {
      new callee();
      log.push("constructed");
    } catch (error: any) {
      log.push(error.constructor.name);
    }
  }
});
console.log(log.join("\n"));
export {};
