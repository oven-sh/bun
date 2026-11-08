// Prints the frames under a constructor that is called by Reflect.construct(..) with operands whose kinds are not known where the call is written.
const top = s =>
  String(s)
    .split("\n")
    .filter(l => l.trimStart().startsWith("at "))
    .slice(0, 3)
    .map(l => l.trim().replace(/ ?\(?[^ (]*:\d+:\d+\)?$/, ""))
    .join(" | ");
class A {
  constructor() {
    this.s = new Error("x").stack;
  }
}
class B extends A {}
function F() {
  this.s = new Error("x").stack;
}
const through = new Function("return arguments[0]");
const mixed = [1, "a", null, A, F, B, {}, []];
function pick(n) {
  return mixed[n];
}
console.log("through text", top(Reflect.construct(through(A), []).s));
console.log("from a mixed list", top(Reflect.construct(pick(3), []).s), "/", top(Reflect.construct(pick(4), []).s));
console.log("a list through text", top(Reflect.construct(A, through([])).s));
console.log("a new target through text", top(Reflect.construct(A, [], through(B)).s));
console.log("all three", top(Reflect.construct(through(F), through([1]), through(B)).s));
console.log("bound", top(Reflect.construct(through(A.bind(null)), []).s));
console.log("proxy", top(Reflect.construct(through(new Proxy(A, {})), []).s));
for (const bad of [1, "a", null, undefined, {}, () => {}]) {
  try {
    Reflect.construct(through(bad), []);
  } catch (e) {
    console.log("refused", String(e), top(e.stack));
  }
  try {
    Reflect.construct(A, through(bad));
    console.log("taken");
  } catch (e) {
    console.log("refused list", String(e), top(e.stack));
  }
  try {
    Reflect.construct(A, [], through(bad));
  } catch (e) {
    console.log("refused new target", String(e), top(e.stack));
  }
}
