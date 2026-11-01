// A class is evaluated five times below the same parents, and five times below a parent that is itself evaluated anew each time.
// Later evaluations may share what the run time keeps from earlier ones. What is done to one evaluation must not show in another.
function below(parent) {
  return class Derived extends parent {
    static label = "derived";
    method() { return "method"; }
    get value() { return 1; }
  };
}
function alone() {
  return class Other {
    method() { return "other"; }
    static make() { return new this(); }
  };
}
function describe(made) {
  return [
    Object.getOwnPropertyNames(made).join(),
    Object.getOwnPropertyNames(made.prototype).join(),
    Object.getPrototypeOf(made).name || "(none)",
    Object.getPrototypeOf(made.prototype) === Object.getPrototypeOf(made).prototype,
    made.prototype.constructor === made,
    new made().method(),
  ].join(" | ");
}
class Fixed {}
const lines = [];
const sameParent = [], newParent = [], parents = [];
for (let i = 0; i < 5; i++) {
  sameParent.push(below(Fixed));
  parents.push(alone());
  newParent.push(below(parents[i]));
}
for (const list of [sameParent, parents, newParent]) {
  for (const made of list) lines.push(describe(made));
  lines.push(new Set(list).size, new Set(list.map(made => made.prototype)).size, new Set(list.map(made => made.prototype.method)).size);
}
// Changes to the third evaluation alone.
for (const list of [sameParent, parents, newParent]) {
  list[2].added = 1;
  list[2].prototype.added = 2;
  delete list[2].prototype.method;
  Object.defineProperty(list[3].prototype, "method", { value: () => "redefined" });
  Object.setPrototypeOf(list[4].prototype, { method() { return "from a new parent"; }, inherited: true });
  for (const made of list) {
    let result;
    try { result = new made().method(); } catch (error) { result = error.constructor.name; }
    lines.push(`${"added" in made} ${"added" in made.prototype} ${result} ${new made().inherited}`);
  }
}
// More evaluations after the changes are as the first ones were.
lines.push(describe(below(Fixed)), describe(alone()), describe(below(parents[0])), describe(below(parents[0])), describe(below(parents[0])));
console.log(lines.join("\n"));
