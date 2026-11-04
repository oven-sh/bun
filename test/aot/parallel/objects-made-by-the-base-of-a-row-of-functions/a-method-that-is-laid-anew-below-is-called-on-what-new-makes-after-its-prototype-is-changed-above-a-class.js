const kept = [];
const unseen = (0, eval);
// Made by test/aot/tools/generate-objects-made-by-the-base-of-a-row-of-functions.py.
function show(x) {
  return typeof x === "function" ? "function" : typeof x === "object" && x !== null ? "object" : String(x);
}
function attempt(work) {
  try {
    return show(work());
  } catch (error) {
    return "thrown: " + error.name;
  }
}
function Base(a) {
  this.a = a;
}
Base.prototype.first = function () { return "first of Base " + this.a; };
Base.prototype.second = function () { return "second of Base " + this.a; };
class Below extends Base {
  constructor(a, b) { super(a); this.b = b; }
  second() { return "second of Below " + this.b; }
  third() { return "third of Below " + this.b; }
}
function run(n) {
  let said = "";
  for (let i = 0; i < n; i++) {
    const below = new Below(i, i + 10);
    const made = new Base(i);
    if (i === 2) Object.setPrototypeOf(made, { first() { return "first of a new prototype"; }, second() { return "second of a new prototype"; } });
    said += attempt(() => made.second()) + " | " + attempt(() => below.second()) + "\n";
  }
  return said;
}
console.log(run(4) + attempt(() => new Base(7).first()) + " " + kept.length);
