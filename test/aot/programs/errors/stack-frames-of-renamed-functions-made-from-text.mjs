const top = (s, n = 3) =>
  String(s)
    .split("\n")
    .filter(l => l.trimStart().startsWith("at "))
    .slice(0, n)
    .map(l => l.trim().replace(/ ?\(?[^ (]*:\d+:\d+\)?$/, ""))
    .join(" | ");
function inner() {
  return new Error("x").stack;
}
const make = () => new Function("inner", "return function () { return inner(); }")(inner);
const a = make();
console.log("1 not renamed", top(a()));
Object.defineProperty(a, "name", { value: "one" });
console.log("2 renamed", JSON.stringify(Object.getOwnPropertyDescriptor(a, "name")), top(a()));
const b = new Function("return new Error('x').stack");
console.log("3 the outer function", top(b()));
Object.defineProperty(b, "name", { value: "two" });
console.log("4 renamed", top(b()));
const c = new Function("return function written() { return new Error('x').stack; }")();
console.log("5 written", top(c()));
Object.defineProperty(c, "name", { value: "three" });
console.log("6 renamed", top(c()));
const d = new Function(
  "const f = function () { return new Error('x').stack; }; Object.defineProperty(f, 'name', { value: 'four' }); return f;",
)();
console.log("7 renamed by the text itself", top(d()));
const e = make();
e.displayName = "five";
console.log("8 displayName", top(e()));
const f = (0, eval)("(function () { return new Error('x').stack; })");
Object.defineProperty(f, "name", { value: "six" });
console.log("9 eval", top(f()));
console.log(a.constructor === Function, Object.prototype.toString.call(a), typeof a);
