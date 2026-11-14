// One of two function objects of the same function is renamed where the compiler cannot see it. A call of the other one shows its own name.
const top = error => String(error.stack).split("\n").filter(line => /^\s+at /.test(line)).slice(0, 2).map(line => line.trim().replace(/\(?[^\s(]*[\\/]([^\\/\s:]+:\d+:\d+)\)?/, "$1")).join(" < ");
const hide = value => [value][0];
function show(label, run) { try { run(); } catch (error) { console.log(label, top(error)); } }
function makeA() { return function inner() { throw new Error("a"); }; }
function makeB() { return function inner() { throw new Error("b"); }; }
function makeC() { return function inner() { throw new Error("c"); }; }
function makeD() { return function inner() { throw new Error("d"); }; }
function makeE() { return function inner() { throw new Error("e"); }; }
{
  const first = makeA(), second = makeA();
  (0, eval)("f => Object.defineProperty(f, 'name', { value: 'byEval' })")(first);
  show("eval, renamed", () => first()); show("eval, sibling", () => second());
}
{
  const first = makeB(), second = makeB();
  new Function("f", "Object.defineProperty(f, 'name', { value: 'byNewFunction' })")(first);
  show("new Function, renamed", () => first()); show("new Function, sibling", () => second());
}
{
  const first = makeC(), second = makeC();
  Object.defineProperty(hide(first), hide("name"), { value: "byUnknownKey" });
  show("unknown key, renamed", () => first()); show("unknown key, sibling", () => second());
}
{
  const first = makeD(), second = makeD();
  Reflect.defineProperty(hide({ f: first }).f, ["na", "me"].join(""), { value: "byJoinedKey" });
  show("joined key, renamed", () => first()); show("joined key, sibling", () => second());
}
{
  const first = makeE(), second = makeE();
  class Returns { constructor(f) { return f; } }
  class Lays extends Returns { name = "byField"; }
  try { new Lays(first); } catch (error) { console.log("field refused", error.name); }
  show("field, renamed", () => first()); show("field, sibling", () => second());
}
