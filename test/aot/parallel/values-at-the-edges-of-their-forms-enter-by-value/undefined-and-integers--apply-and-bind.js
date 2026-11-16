class Box { value; constructor(value) { this.value = value; } describe() { return "box " + show(this.value); } }
class Crate extends Box { describe() { return "crate " + show(this.value); } }
class Other { value; constructor(value) { this.value = value; } describe() { return "other " + show(this.value); } }
function grown(box) { box.extra = 1; return box; }
function shrunk(box) { delete box.value; return box; }
function show(x) {
  if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
  if (typeof x === "bigint") return x + "n";
  if (typeof x === "symbol") return x.toString();
  if (typeof x === "function") return "function " + x.length;
  if (x === null || typeof x !== "object") return String(x);
  if (Array.isArray(x)) return "[" + x.length + "]";
  if (typeof x.describe === "function") return x.describe();
  return Object.prototype.toString.call(x) + Object.keys(x).join();
}
const values = [undefined, 1, 2147483648];
function tell(x, y) { return show(x) + "," + show(y); } console.log(Array.from(values, (x) => tell.apply(null, [x, x]) + ";" + tell.bind(null, x)(x)).join(" | "));
