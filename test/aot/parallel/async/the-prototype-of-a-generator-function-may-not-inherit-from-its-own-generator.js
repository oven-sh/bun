// The prototype object of a generator function is told to inherit from one of that function's own generators: a cycle, which is refused.
const hide = (0, eval)("x => x // ".slice(0, process.argv.length > 1000 ? 1 : 6));
function make(tag) {
  return hide(function* () {
    yield tag;
  });
}
const out = [];
const attempt = (what, run) => { try { out.push(what + ": " + run()); } catch (error) { out.push(what + ": " + error.constructor.name + ": " + error.message); } };
{
  const f = make("a"), g = hide(f());
  attempt("setPrototypeOf", () => Object.setPrototypeOf(f.prototype, g) === f.prototype);
  attempt("behind it", () => [typeof g.next, Object.getPrototypeOf(g) === f.prototype, Object.getPrototypeOf(f.prototype) === g, g.nothing]);
}
{
  const f = make("b"), g = hide(f());
  attempt("Reflect.setPrototypeOf", () => Reflect.setPrototypeOf(f.prototype, g));
  attempt("behind it", () => [typeof g.next, Object.getPrototypeOf(f.prototype) === g, g.nothing]);
}
{
  const f = make("c"), g = hide(f());
  attempt("__proto__", () => { f.prototype.__proto__ = g; return "stored"; });
  attempt("behind it", () => [typeof g.next, Object.getPrototypeOf(f.prototype) === g, g.nothing]);
}
{
  const f = make("d"), g = hide(f()), between = hide(Object.create(g));
  attempt("through an object between", () => Reflect.setPrototypeOf(f.prototype, between));
  attempt("behind it", () => [typeof between.next, Object.getPrototypeOf(f.prototype) === between, between.nothing]);
}
{
  const f = make("e"), other = make("f"), g = hide(other());
  attempt("of another function: no cycle", () => Reflect.setPrototypeOf(f.prototype, g));
  attempt("behind it", () => [typeof hide(f()).next, Object.getPrototypeOf(f.prototype) === g, Object.getPrototypeOf(g) === other.prototype, hide(f()).next().value]);
}
console.log(out.join("\n"));
