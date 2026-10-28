// Prints where a stack trace places a list pattern that takes what cannot be iterated: in a catch clause, in the head of a loop, and behind constants in whose place their values are printed.
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
const inThisFile = /stack-positions-of-list-patterns-behind-catch-for-and-constants/;
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
show("try { throw nothing; } catch ([a]) {}", () => { try { throw nothing; } catch ([a]) {} });
show("try { throw five; } catch ([a]) {}", () => { try { throw five; } catch ([a]) {} });
show("try { throw nothing; } catch ({ a }) {}", () => { try { throw nothing; } catch ({ a }) {} });
show("try { pass(1); throw nothing; } catch ([a, b]) {}", () => { try { pass(1); throw nothing; } catch ([a, b]) {} });
show("try { throw nothing; } /* c */ catch /* d */ ([a]) {}", () => { try { throw nothing; } /* c */ catch /* d */ ([a]) {} });
show("try { throw [nothing]; } catch ([[a]]) {}", () => { try { throw [nothing]; } catch ([[a]]) {} });
show("try { throw [nothing]; } catch ([{ a }]) {}", () => { try { throw [nothing]; } catch ([{ a }]) {} });
show("try { throw { a: nothing }; } catch ({ a: [b] }) {}", () => { try { throw { a: nothing }; } catch ({ a: [b] }) {} });
show("for (let [a] = nothing; ; ) {}", () => { for (let [a] = nothing; ; ) {} });
show("for (const [a] = nothing; ; ) {}", () => { for (const [a] = nothing; ; ) {} });
show("for (var [a] = nothing; ; ) {}", () => { for (var [a] = nothing; ; ) {} });
show("for (let a = 1, [b] = nothing; ; ) {}", () => { for (let a = 1, [b] = nothing; ; ) {} });
show("for (let a = five, [b] = nothing; ; ) {}", () => { for (let a = five, [b] = nothing; ; ) {} });
show("for (let { a } = nothing; ; ) {}", () => { for (let { a } = nothing; ; ) {} });
show("for (let [[a]] = [nothing]; ; ) {}", () => { for (let [[a]] = [nothing]; ; ) {} });
show("const a1 = 1, [x] = nothing;", () => { const a1 = 1, [x] = nothing; });
show("const a1 = five, [x] = nothing;", () => { const a1 = five, [x] = nothing; });
show("const a1 = \"s\", a2 = 2, [x] = nothing;", () => { const a1 = "s", a2 = 2, [x] = nothing; });
show("let a1 = 1, [x] = nothing;", () => { let a1 = 1, [x] = nothing; });
show("pass(1); const a1 = 1, [x] = nothing;", () => { pass(1); const a1 = 1, [x] = nothing; });
show("const a1 = 1; const [x] = nothing;", () => { const a1 = 1; const [x] = nothing; });
show("const a1 = 1; const a2 = five; const [x] = nothing;", () => { const a1 = 1; const a2 = five; const [x] = nothing; });
show("const a1 = 1; pass(a1); const [x] = nothing;", () => { const a1 = 1; pass(a1); const [x] = nothing; });
show("(function ({ x }) { const a = 1; })(nothing);", () => { (function ({ x }) { const a = 1; })(nothing); });
show("(function ({ x }) { const a = 1, b = \"s\"; })(nothing);", () => { (function ({ x }) { const a = 1, b = "s"; })(nothing); });
show("(function ({ x }) { const a = 1, b = five; })(nothing);", () => { (function ({ x }) { const a = 1, b = five; })(nothing); });
show("(function ({ x }) { const b = five, a = 1; })(nothing);", () => { (function ({ x }) { const b = five, a = 1; })(nothing); });
show("(function ({ x }) { const a = 1; const b = 2; })(nothing);", () => { (function ({ x }) { const a = 1; const b = 2; })(nothing); });
show("(function ({ x }) { pass(1); const a = 1; })(nothing);", () => { (function ({ x }) { pass(1); const a = 1; })(nothing); });
show("(function ({ x }) { let a = 1; })(nothing);", () => { (function ({ x }) { let a = 1; })(nothing); });
show("(function ({ x }) { const a = 1; pass(a); const b = 2; })(nothing);", () => { (function ({ x }) { const a = 1; pass(a); const b = 2; })(nothing); });
show("const a0 = five; const a1 = 1; const [x] = nothing;", () => { const a0 = five; const a1 = 1; const [x] = nothing; });
show("const a1 = 1; const a2 = 2; const [x] = nothing;", () => { const a1 = 1; const a2 = 2; const [x] = nothing; });
show("const a1 = 1; let [x] = nothing;", () => { const a1 = 1; let [x] = nothing; });
show("const a1 = 1; const once = pass(nothing); return once.x;", () => { const a1 = 1; const once = pass(nothing); return once.x; });
show("const once = pass(nothing); const a1 = 1; return once.x;", () => { const once = pass(nothing); const a1 = 1; return once.x; });
