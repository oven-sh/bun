// A class with `declare` fields IS extended by mixins whose accessors have names computed at run time, and one of the names is a field's. A store in the class's own method then runs the setter, or throws where there is only a getter, and makes no property of the object; a read runs the getter. Objects of the class itself are not touched by that.
const log: string[] = [];
function withBoth<T extends new (...args: any[]) => any>(Base: T, name: string) {
  return class extends Base {
    get [name]() { log.push("get"); return -1; }
    set [name](value: number) { log.push("set " + value); }
  };
}
function withGetter<T extends new (...args: any[]) => any>(Base: T, name: string) {
  return class extends Base {
    get [name]() { return -2; }
  };
}
function withMethod<T extends new (...args: any[]) => any>(Base: T, name: string) {
  return class extends Base {
    [name]() { return -3; }
  };
}
class Holder {
  declare shadowed: number;
  declare own: number;
  fill(value: number): void { this.shadowed = value; this.own = value + 1; }
  fillOwnFirst(value: number): void { this.own = value + 1; this.shadowed = value; }
  read(): string { return (typeof this.shadowed === "function" ? "a function" : String(this.shadowed)) + " " + String(this.own); }
  has(): string { return ("shadowed" in this) + " " + Object.hasOwn(this, "shadowed") + " " + ("own" in this) + " " + Object.hasOwn(this, "own"); }
}
class Below extends Holder {
  declare further: string;
  fillAll(value: number): void { this.fill(value); this.further = "f"; }
}
const name = ["shad", "owed"].join("");
function show(what: string, made: Holder, fill: (made: Holder) => void): void {
  let thrown = "";
  console.log(what + ", empty: " + made.read() + " | " + made.has() + " | " + Object.keys(made).join());
  try { fill(made); } catch (error) { thrown = (error as Error).name; }
  console.log(what + ": " + made.read() + " | " + made.has() + " | " + Object.keys(made).join() + " | " + JSON.stringify(made) + " | " + log.join() + " | " + thrown);
  log.length = 0;
}
const classes: [string, new () => Holder][] = [
  ["the class itself", Holder],
  ["accessor pair", withBoth(Holder, name)],
  ["getter only", withGetter(Holder, name)],
  ["method", withMethod(Holder, name)],
  ["another name", withBoth(Holder, "other")],
  ["below", Below],
  ["accessor pair over the subclass", withBoth(Below, name)],
  ["two mixins", withBoth(withGetter(Holder, "other"), name)],
];
for (const [what, made] of classes) {
  show(what, new made(), made => made.fill(5));
  show(what + ", the other field first", new made(), made => made.fillOwnFirst(7));
}
show("all three", new (withBoth(Below, name))(), made => (made as Below).fillAll(9));
let total = 0;
for (let i = 0; i < 300; i++) {
  const made = new (classes[i % classes.length]![1])();
  try { made.fill(i); } catch {}
  total += Object.keys(made).length;
}
console.log(total, log.length);
