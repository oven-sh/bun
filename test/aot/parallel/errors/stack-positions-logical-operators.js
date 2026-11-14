// Prints where a stack trace places what follows a logical operator whose left operand is a literal. Bun's transpiler prints one of the two operands.
function pass(value) {
  return value;
}
function fail() {
  throw new Error("fail");
}
function Made() {}
const nothing = null;
const missing = undefined;
const symbol = Symbol("symbol");
const holder = { a: null, f: 5, s: "text", arr: [1], nested: { deep: null }, g() { return { h: 1 }; } };
let five = 5;
let key = "nope";
const inThisFile = /stack-positions-logical-operators/;
function placesOf(error) {
  return String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
}
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", placesOf(error).slice(0, -2).join(" "));
  }
}
show("(function () { fail(); return (150 || pass(1)); })();", () => { (function () { fail(); return (150 || pass(1)); })(); });
show("(function () { fail(); return (0 || pass(1)); })();", () => { (function () { fail(); return (0 || pass(1)); })(); });
show("(function () { fail(); return (0 && pass(1)); })();", () => { (function () { fail(); return (0 && pass(1)); })(); });
show("(function () { fail(); return (1 && pass(1)); })();", () => { (function () { fail(); return (1 && pass(1)); })(); });
show("(function () { fail(); return (null ?? pass(1)); })();", () => { (function () { fail(); return (null ?? pass(1)); })(); });
show("(function () { fail(); return (1 ?? pass(1)); })();", () => { (function () { fail(); return (1 ?? pass(1)); })(); });
show("(function () { fail(); return (\"\" || pass(1)); })();", () => { (function () { fail(); return ("" || pass(1)); })(); });
show("(function () { fail(); return (\"a\" || pass(1)); })();", () => { (function () { fail(); return ("a" || pass(1)); })(); });
show("(function () { fail(); return (five || pass(1)); })();", () => { (function () { fail(); return (five || pass(1)); })(); });
show("(function () { fail(); return (true && five); })();", () => { (function () { fail(); return (true && five); })(); });
show("(function () { fail(); return (false || five); })();", () => { (function () { fail(); return (false || five); })(); });
show("(function () { const c = 0; fail(); return (c || pass(1)); })();", () => { (function () { const c = 0; fail(); return (c || pass(1)); })(); });
show("(function () { fail(); pass(150 || pass(1)); })();", () => { (function () { fail(); pass(150 || pass(1)); })(); });
show("(150 || pass(1))();", () => { (150 || pass(1))(); });
show("(0 || nothing)();", () => { (0 || nothing)(); });
show("(150 || pass(1)).x.y;", () => { (150 || pass(1)).x.y; });
show("(0 || holder.a).x;", () => { (0 || holder.a).x; });
