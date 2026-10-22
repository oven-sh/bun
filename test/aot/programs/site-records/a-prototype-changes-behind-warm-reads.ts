// Reads, stores and calls run a thousand times on the same few objects, so that whatever can be learned has been learned. Then one thing changes on a prototype, and the very next visit sees it. Then a thousand visits again, and the next change.
class Base {
  inheritedField = "own, defined by Base";
  method(): string {
    return "Base.method";
  }
  get computed(): string {
    return "Base.computed";
  }
}
class Derived extends Base {
  own = 1;
  declare missing?: string;
  declare onPrototype: string;
}
(Derived.prototype as any).onPrototype = "on Derived.prototype";

function ownOf(value: Derived): unknown {
  return value.own;
}
function missingOf(value: Derived): unknown {
  return value.missing;
}
function onPrototypeOf(value: Derived): unknown {
  return value.onPrototype;
}
function computedOf(value: Derived): unknown {
  return value.computed;
}
function callMethod(value: Derived): unknown {
  return value.method();
}
function setMissing(value: Derived, to: string): void {
  value.missing = to;
}
function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}

const first = new Derived();
const second = new Derived();
const parsed: Derived = Object.setPrototypeOf(JSON.parse('{"pad":0,"own":2}'), Derived.prototype);
const trail: string[] = [];

function facts(value: Derived): string {
  return [attempt(() => ownOf(value)), attempt(() => missingOf(value)), attempt(() => onPrototypeOf(value)), attempt(() => computedOf(value)), attempt(() => callMethod(value))].join(",");
}
function warm(): string {
  let last = "";
  let changes = 0;
  for (let i = 0; i < 1000; i++) {
    const now = facts(first) + " / " + facts(second) + " / " + facts(parsed);
    if (now !== last) changes++;
    last = now;
  }
  trail.length = 0;
  return changes === 1 ? "steady" : "changed " + changes + " times";
}
function look(mark: string): void {
  console.log(mark + ":", facts(first), "/", facts(parsed), trail.splice(0).join(";"));
  console.log("  then", warm(), "|", facts(second));
}

console.log(warm());
look("at first");
(Derived.prototype as any).missing = "appeared on Derived.prototype";
look("the missing field appears above");
(Derived.prototype as any).missing = "changed there";
look("and changes there");
delete (Derived.prototype as any).missing;
look("and goes away");
(Base.prototype as any).missing = "appeared on Base.prototype";
look("appears two levels up");
Object.defineProperty(Base.prototype, "missing", {
  get() {
    trail.push("getter");
    return "a getter two levels up";
  },
  set(value: string) {
    trail.push("setter " + value);
  },
  configurable: true,
});
look("becomes an accessor there");
setMissing(first, "through the setter");
look("a store goes through the setter");
delete (Base.prototype as any).missing;
setMissing(first, "own now");
look("the accessor is gone and one object has its own");
(Derived.prototype as any).onPrototype = "changed on Derived.prototype";
look("the value on the prototype changes");
delete (Derived.prototype as any).onPrototype;
look("the value on the prototype goes away");
(Derived.prototype as any).onPrototype = "back";
Base.prototype.method = () => "replaced Base.method";
look("the method is replaced");
(Derived.prototype as any).method = () => "Derived.method hides it";
look("the method is hidden one level below");
delete (Derived.prototype as any).method;
look("and shows again");
Object.defineProperty(Base.prototype, "computed", { get: () => "another getter", configurable: true });
look("the getter is replaced");
Object.defineProperty(Base.prototype, "computed", { value: "a plain value", configurable: true, writable: true });
look("the getter becomes a value");
Object.defineProperty(Derived.prototype, "own", { get: () => "never seen: the objects have their own", configurable: true });
look("an accessor above a field that the objects have");
delete (first as any).own;
look("one object loses the field");
delete (Derived.prototype as any).own;
look("the accessor goes away");
Object.setPrototypeOf(Derived.prototype, { method: () => "method of a literal", computed: "computed of a literal", missing: "missing of a literal" });
look("the class hangs below a literal");
Object.setPrototypeOf(Derived.prototype, Base.prototype);
look("and below Base again");
Object.setPrototypeOf(first, Base.prototype);
look("one object hangs below Base");
Object.setPrototypeOf(parsed, null);
look("another hangs nowhere");

export {};
