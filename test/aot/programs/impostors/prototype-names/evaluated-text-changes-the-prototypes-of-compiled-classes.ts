// Text that is evaluated at run time changes the prototypes of three compiled classes:
// a function made by `new Function` that gets the class, an indirect eval that finds the class on the global object, and a direct eval.
class ByFunctionText {
  declare id: number;
  declare extra?: number;
  constructor(id: number) {
    this.id = id;
  }
}
class ByIndirectEval {
  declare id: number;
  declare extra?: number;
  constructor(id: number) {
    this.id = id;
  }
}
class ByDirectEval {
  declare id: number;
  declare extra?: number;
  constructor(id: number) {
    this.id = id;
  }
}
function one(object: ByFunctionText) {
  return object.extra;
}
function two(object: ByIndirectEval) {
  return object.extra;
}
function three(object: ByDirectEval) {
  return object.extra;
}
function setOne(object: ByFunctionText, value: number) {
  object.extra = value;
}
function setTwo(object: ByIndirectEval, value: number) {
  object.extra = value;
}
function setThree(object: ByDirectEval, value: number) {
  object.extra = value;
}
function state(object: { extra?: number }) {
  return `${object.extra} ${"extra" in object} [${Object.keys(object)}]`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const a = new ByFunctionText(i);
  const b = new ByIndirectEval(i);
  const c = new ByDirectEval(i);
  sum += (one(a) ?? 1) + (two(b) ?? 1) + (three(c) ?? 1);
  if (i & 1) {
    setOne(a, 2);
    setTwo(b, 2);
    setThree(c, 2);
  }
  sum += (one(a) ?? 1) + (two(b) ?? 1) + (three(c) ?? 1);
}
console.log("warm", sum);

const a = new ByFunctionText(1);
const b = new ByIndirectEval(2);
const c = new ByDirectEval(3);
(globalThis as any).seen = [];
new Function("target", "key", "target.prototype[key] = 10")(ByFunctionText, "extra");
(globalThis as any).Exposed = ByIndirectEval;
(0, eval)("Object.defineProperty(Exposed.prototype, 'extra', { get() { return this.id * 10 }, set(v) { seen.push('two ' + v) }, configurable: true })");
eval("Object.defineProperty(ByDirectEval.prototype, 'extra', { set(v) { seen.push('three ' + v) }, configurable: true })");
console.log("changed:", state(a), "|", state(b), "|", state(c));
console.log("typed reads:", one(a), two(b), three(c), one(new ByFunctionText(4)), two(new ByIndirectEval(5)), three(new ByDirectEval(6)));
setOne(a, 100);
setTwo(b, 200);
setThree(c, 300);
setTwo(new ByIndirectEval(7), 201);
setThree(new ByDirectEval(8), 301);
console.log("stored:", state(a), "|", state(b), "|", state(c), "|", (globalThis as any).seen.join(", "));
new Function("a", "b", "c", "delete a.prototype.extra; delete b.prototype.extra; delete c.prototype.extra")(ByFunctionText, ByIndirectEval, ByDirectEval);
console.log("gone again:", state(a), "|", state(b), "|", state(c));
setTwo(b, 202);
setThree(c, 302);
console.log("stored:", state(b), "|", state(c), "|", (globalThis as any).seen.length);
