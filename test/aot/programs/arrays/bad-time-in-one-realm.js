// An index accessor on a prototype of arrays gives one realm a bad time and no other. First a node:vm context has one, then the compiled realm: each time the arrays, arguments objects and match results that the other realms create stay what they were.
const vm = require("vm");

function integers(first, last) {
  return [first, , last];
}

function doubles(first, last) {
  return [first + 0.5, , last + 0.5];
}

function strings(first, last) {
  return [String(first), , String(last)];
}

function constantIntegers() {
  return [1, 2, 3];
}

function constantDoubles() {
  return [1.5, 2.5, 3.5];
}

function constantStrings() {
  return ["a", "b", "c"];
}

function argumentsObject() {
  return arguments;
}

function matchResult(text) {
  return /(x)?c/.exec(text);
}

const kinds = [
  ["integers", () => integers(1, 3)],
  ["doubles", () => doubles(1, 3)],
  ["strings", () => strings(1, 3)],
  ["constant integers", constantIntegers],
  ["constant doubles", constantDoubles],
  ["constant strings", constantStrings],
  ["arguments", () => argumentsObject(1, 2, 3)],
  ["match result", () => matchResult("c")],
];

function readAndStore(created) {
  const before = String(created[1]);
  created[1] = "stored";
  return created.length + " " + before + " " + created[1];
}

function describeCompiledRealm() {
  return kinds.map(([name, create]) => name + ": " + readAndStore(create())).join(", ");
}

function createRealm() {
  const context = vm.createContext({});
  vm.runInContext("var stores = 0;", context);
  return context;
}

function describeContext(context) {
  return vm.runInContext("(() => { const holes = [1, , 3]; const before = String(holes[1]); holes[1] = 'stored'; return before + ' ' + holes[1] + ' ' + stores; })()", context);
}

const changed = createRealm();
const unchanged = createRealm();

function report(when) {
  console.log(when);
  console.log("  compiled realm: " + describeCompiledRealm());
  console.log("  changed context: " + describeContext(changed));
  console.log("  unchanged context: " + describeContext(unchanged));
  console.log("  array of the changed context: " + readAndStore(vm.runInContext("[1, , 3]", changed)));
  console.log("  array of the unchanged context: " + readAndStore(vm.runInContext("[1, , 3]", unchanged)));
}

report("before");

vm.runInContext("Object.defineProperty(Array.prototype, 1, { get() { return 'inherited'; }, set(value) { stores++; }, configurable: true });", changed);
report("after the accessor in the context");

class Rows extends Array {}
const rows = new Rows(3);
Object.defineProperty(Rows.prototype, 1, {
  get() {
    return "inherited";
  },
  configurable: true,
});
report("after the accessor in the compiled realm");
console.log("  subclass: " + rows.length + " " + rows[1] + " " + new Rows(2)[1] + " " + String(new Rows(2)[0]));
