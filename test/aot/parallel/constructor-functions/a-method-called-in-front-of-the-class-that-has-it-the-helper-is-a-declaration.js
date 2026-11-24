// In a function that runs once, a method is called on an object before the class that declares a method of that name is evaluated. The method of the class captures the class, which is not there yet.
const any = globalThis;
function build(tag) {
  function Base() { this.kind = "base"; }
  Base.prototype.tell = function () { return "base " + this.kind; };
  function lay(sub, above) {
    if (typeof above !== "function" && above !== null) throw new TypeError("no");
    sub.prototype = Object.create(above.prototype, { constructor: { value: sub, writable: true, configurable: true } });
    if (above) Object.setPrototypeOf(sub, above);
    return Object.defineProperty(sub, "prototype", { writable: false });
  }
  const Mid = lay(function Mid() { const self = Reflect.construct(Base, [], new.target || Base); self.kind = tag; return self; }, Base);
  function Third() { return Reflect.construct(Mid, [], Third); }
  Third.prototype = Object.create(Mid.prototype); Object.setPrototypeOf(Third, Mid);
  const found = [];
  const made = Reflect.construct(Mid, [], Third); found.push(made instanceof Third, Mid.prototype.isPrototypeOf(made), made.tell());
  class Last extends Mid { tell() { return "last " + super.tell(); } }
  return found.join(",") + " " + new Last().tell();
}
console.log(build(String(any.nothing ?? "t")));
