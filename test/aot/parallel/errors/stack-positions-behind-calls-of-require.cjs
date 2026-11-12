// Prints where a stack trace places a call or an access behind `require` with a literal.
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
const inThisFile = /stack-positions-behind-calls-of-require/;
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
show("require(\"node:assert\")(false);", () => { require("node:assert")(false); });
show("require(\"node:assert\").x.y;", () => { require("node:assert").x.y; });
show("require(\"node:assert\").x();", () => { require("node:assert").x(); });
show("require(\"node:assert\").ok(false);", () => { require("node:assert").ok(false); });
show("require(\"node:assert\")[\"ok\"](false);", () => { require("node:assert")["ok"](false); });
show("require(\"node:assert\")[key]();", () => { require("node:assert")[key](); });
show("new (require(\"node:assert\"))();", () => { new (require("node:assert"))(); });
show("new (require(\"node:events\"))().x.y;", () => { new (require("node:events"))().x.y; });
show("require(\"node:assert\")``;", () => { require("node:assert")``; });
show("pass(require(\"node:assert\"))(false);", () => { pass(require("node:assert"))(false); });
show("const a = require(\"node:assert\"); a(false);", () => { const a = require("node:assert"); a(false); });
show("require(pass(\"node:assert\"))(false);", () => { require(pass("node:assert"))(false); });
show("require(\"node:\" + \"assert\")(false);", () => { require("node:" + "assert")(false); });
show("require(`node:assert`)(false);", () => { require(`node:assert`)(false); });
show("require.resolve(\"node:assert\")();", () => { require.resolve("node:assert")(); });
show("require(\"node:assert\") + symbol;", () => { require("node:assert") + symbol; });
show("symbol + require(\"node:assert\");", () => { symbol + require("node:assert"); });
show("[...require(\"node:assert\")];", () => { [...require("node:assert")]; });
