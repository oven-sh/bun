// Keys that are inherited come behind the own ones, a shadowed key comes once, and of an inherited key `hasOwn` says no while `in` says yes.
function walk(o) {
  let text = "";
  for (const k in o) text += k + "=" + o[k] + (k in o ? "+" : "-") + (Object.hasOwn(o, k) ? "own " : "not ");
  return text;
}
function deed() {
  const base = { a: "base-a", z: "base-z" };
  const o = Object.create(base);
  o.b = 2;
  o.a = 1;
  Object.defineProperty(o, "hidden", { value: 3, enumerable: false });
  Object.defineProperty(base, "hidden", { value: 4, enumerable: true, configurable: true });
  return walk(o);
}
class Base { constructor() { this.own = 1; } method() {} }
Base.prototype.laid = "on the prototype";
console.log(deed(), "|", walk(new Base()));
for (let i = 0; i < 3; i++) console.log(walk({ a: i }), "|", deed(), "|", walk(new Base()));
