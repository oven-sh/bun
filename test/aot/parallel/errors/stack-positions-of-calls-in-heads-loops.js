// Prints where a stack trace places what throws in the expression that a loop walks.
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
const holder = { a: null, f: 5, s: "text", arr: [1], nested: { deep: null }, g() { return { h: 1 }; }, m() { throw new Error("m"); } };
let five = 5;
let key = "nope";
const inThisFile = /stack-positions-of-calls-in-heads-loops/;
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
show("for (const [a, b] of Object.entries(missing)) {}", () => { for (const [a, b] of Object.entries(missing)) {} });
show("for (const a of Object.entries(missing)) {}", () => { for (const a of Object.entries(missing)) {} });
show("for (const a of Object.keys(missing)) {}", () => { for (const a of Object.keys(missing)) {} });
show("for (const a of Object.values(nothing)) {}", () => { for (const a of Object.values(nothing)) {} });
show("for (const [a, b] of Object.entries(pass(missing))) {}", () => { for (const [a, b] of Object.entries(pass(missing))) {} });
show("for (const [a] of pass(missing)) {}", () => { for (const [a] of pass(missing)) {} });
show("for (const a of pass(missing)) {}", () => { for (const a of pass(missing)) {} });
show("for (const a of holder.m()) {}", () => { for (const a of holder.m()) {} });
show("for (const a of fail()) {}", () => { for (const a of fail()) {} });
show("for (const [a, b] of fail()) {}", () => { for (const [a, b] of fail()) {} });
show("for (const a of holder.arr.map(five)) {}", () => { for (const a of holder.arr.map(five)) {} });
show("for (const a of new Map(five)) {}", () => { for (const a of new Map(five)) {} });
show("for (const [a, b] of new Map(five)) {}", () => { for (const [a, b] of new Map(five)) {} });
show("for (const a of Array.from(missing)) {}", () => { for (const a of Array.from(missing)) {} });
show("for (const a of [...u]) {}", () => { for (const a of [...u]) {} });
show("for (const a of holder.a.b) {}", () => { for (const a of holder.a.b) {} });
show("for (const [a, b] of holder.a.b) {}", () => { for (const [a, b] of holder.a.b) {} });
show("for (const a of nothing.x()) {}", () => { for (const a of nothing.x()) {} });
show("for (const a in fail()) {}", () => { for (const a in fail()) {} });
show("for (const a in Object.keys(missing)) {}", () => { for (const a in Object.keys(missing)) {} });
show("const [a, b] = Object.entries(missing);", () => { const [a, b] = Object.entries(missing); });
show("pass(...Object.entries(missing));", () => { pass(...Object.entries(missing)); });
show("[...Object.keys(missing)];", () => { [...Object.keys(missing)]; });
show("for (const [a, b] of Object.entries(missing).sort()) {}", () => { for (const [a, b] of Object.entries(missing).sort()) {} });
show("for (const [a, b] of new Map(Object.entries(missing))) {}", () => { for (const [a, b] of new Map(Object.entries(missing))) {} });
show("Object.entries(missing).forEach(pass);", () => { Object.entries(missing).forEach(pass); });
show("Object.keys(missing).length;", () => { Object.keys(missing).length; });
