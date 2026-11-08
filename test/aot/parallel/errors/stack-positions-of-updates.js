// Prints where a stack trace places errors of `x++`, `x += v` and `x ||= v` on names, members and elements, and of `instanceof` in front of an arrow function.
function pass(value) {
  return value;
}
function fail() {
  throw new Error("thrown");
}
const nothing = null;
const holder = { inner: null, text: "text", number: 5 };
const mark = Symbol("mark");
const key = "number";
let five = 5;
const inThisFile = /stack-positions-of-updates/;
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    const places = String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
    console.log(label, "|", error.constructor.name, "|", places.slice(0, -2).join(" "));
  }
}
show("early name counted up", () => { late++; let late = 1; });
show("early name counted up in front", () => { ++late; let late = 1; });
show("early name counted down behind a call", () => { pass(1); late--; let late = 1; });
show("early name counted as argument", () => { pass(late++); let late = 1; });
show("early name grows", () => { late += 2; let late = 1; });
show("early name shrinks by a call", () => { late -= pass(2); let late = 1; });
show("early name or", () => { late ||= 2; let late = 1; });
show("early name and", () => { late &&= 2; let late = 1; });
show("early name if missing", () => { late ??= 2; let late = 1; });
show("early name stored", () => { pass(1); late = 2; let late = 1; });
show("early captured name", () => { const read = () => late; late++; let late = 1; return read; });
show("symbol counted up", () => { let count = mark; count++; });
show("symbol counted up in front", () => { let count = mark; ++count; });
show("symbol counted behind a call", () => { let count = mark; pass(1); count--; });
show("symbol counted as argument", () => { let count = mark; pass(count++); });
show("symbol captured", () => { let count = mark; const read = () => count; count++; return read; });
show("symbol in a loop's step", () => { for (let count = mark; ; count++) {} });
show("object counted up", () => { let count = { valueOf: fail }; count++; });
show("variable of the file", () => { const kept = five; five = mark; try { five++; } finally { five = kept; } });
show("element of null counted", () => { nothing[key]++; });
show("element of null counted in front", () => { --nothing[key]; });
show("element of null grows", () => { nothing[key] += 1; });
show("element of null and", () => { nothing[key] &&= 1; });
show("element of null or", () => { nothing[key] ||= 1; });
show("element of an inner null", () => { holder.inner[key] -= 1; });
show("element under a call", () => { nothing[pass(key)]++; });
show("element under a read", () => { nothing[holder.text]++; });
show("element under a sum", () => { nothing[key + 1]--; });
show("element under a number", () => { nothing[0]++; });
show("element under a text", () => { nothing["x"] += 1; });
show("inner element under a number", () => { holder.inner[0] += 1; });
show("member of null counted", () => { nothing.x++; });
show("member of an inner null", () => { --holder.inner.x; });
show("symbol in a member", () => { const box = { count: mark }; ++box.count; });
show("symbol in a member behind", () => { const box = { count: mark }; box.count++; });
show("symbol in an element", () => { const box = { number: mark }; box[key]++; });
show("element grows by a method", () => { holder[key] += { valueOf() { fail(); } }; });
show("instance of an arrow function", () => { pass(holder instanceof (() => {})); });
show("literal instance of an arrow function", () => { pass(({}) instanceof (() => {})); });
show("instance of an arrow function alone", () => { ({}) instanceof (() => {}); });
show("instance of an arrow function in a condition", () => { if (holder instanceof (() => {})) pass(1); });
show("instance of a number", () => { pass(holder instanceof five); });
