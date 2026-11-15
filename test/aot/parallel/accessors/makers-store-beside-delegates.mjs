// A maker stores the fields of its objects under names that accessors of computed keys, defined above the objects, might answer: such a store calls no setter.
// STATISTIC: SettersExpectedInLoops <= 2
const proto = { kind: "above" };
function access(target, inner, name) {
  target.__defineGetter__(name, function () { return this[inner][name]; });
  target.__defineSetter__(name, function (value) { this[inner][name] = value; });
}
for (const name of ["first", "second"]) access(proto, "inner", name);
function create(value) {
  const made = Object.create(proto);
  made.inner = { first: value, second: 2 };
  made.outer = value;
  return made;
}
function makes(turns) { let n = 0; for (let k = 0; k < turns; k++) { const made = create(k); n = (n + made.inner.first + made.outer + made.inner.second) & 1023; } return n; }
function reads(turns) { const made = create(3); let n = 0; for (let k = 0; k < turns; k++) n = (n + made.first + made.second) & 1023; return n; }
const lines = [makes(0), makes(1), makes(50), reads(40)];
const one = create(1); one.first = 5;
lines.push(JSON.stringify(one), one.first, one.second, Object.keys(one).join());
const define = new Function("target", "key", "descriptor", "Object.defineProperty(target, key, descriptor)");
let stored = 0;
define(proto, "outer", { configurable: true, get() { return 100; }, set(value) { stored += value; } });
lines.push(makes(4), reads(4), stored, Object.keys(create(1)).join());
define(proto, "inner", { configurable: true, get() { return { first: 7, second: 8 }; }, set(value) { stored += 1000; } });
lines.push(makes(4), reads(4), stored, Object.keys(create(1)).join());
console.log(lines.join("\n"));
