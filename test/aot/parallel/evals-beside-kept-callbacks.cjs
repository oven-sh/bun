// Evals over tables of constants, beside code that changes the tables where the build cannot follow it.
const log = [];
const say = (...parts) => log.push(parts.map(part => (typeof part === "function" ? part.name + part.length : String(part))).join(" "));
const unseen = value => [value, value][new Date().getTime() > 5 ? 1 : 0];
const kept = [];
let hook = null;
const emitter = { forEach(f) { kept.push(f); }, map(f) { kept.push(f); }, fire() { for (const f of kept) f(); kept.length = 0; } };
function keep(f) { hook = f; }
function call(f, list) { return f(list); }
const tests = {
  "parameter"(a) { a = "(function (x) { return x + 1; })"; arguments[0] = unseen("(function (x) { return x + 2; })"); return eval(a)(5); },
  "parameter by call"(a) { a = "(function (x) { return x + 1; })"; call(list => { list[0] = unseen("(function (x) { return x + 3; })"); }, arguments); return eval(a)(5); },
  "forEach that keeps"() { var rows, out = 0; emitter.forEach(function () { rows[0][0] = unseen("-"); }); rows = [["+", "add"]]; emitter.fire(); for (var row of rows) out += eval("(function " + row[1] + "(a, b) { return a " + row[0] + " b; })")(7, 3); return out; },
  "map that keeps"() { var rows, out = 0; emitter.map(() => rows.push([unseen("*"), "mul"])); rows = [["+", "add"]]; emitter.fire(); for (var row of rows) out += eval("(function " + row[1] + "(a, b) { return a " + row[0] + " b; })")(7, 3); return out; },
  "inside a function"() { var rows, out = 0; function inner() { [1].forEach(function () { rows[0][0] = unseen("%"); }); } keep(inner); rows = [["+", "add"]]; hook(); for (var row of rows) out += eval("(function " + row[1] + "(a, b) { return a " + row[0] + " b; })")(7, 3); return out; },
  "by its name"() { var rows, out = 0; [1].forEach(function self(x) { if (x === 1) hook = self; else rows[0][0] = unseen("&"); }); rows = [["+", "add"]]; hook(2); for (var row of rows) out += eval("(function " + row[1] + "(a, b) { return a " + row[0] + " b; })")(7, 3); return out; },
  "a pattern with its own exec"() { var pattern = /\+/g; pattern.exec = unseen(() => null); return eval("(function (a, b) { return a " + "+".replace(pattern, "-") + " b; })")(7, 3); },
  "an ended activation"() { function make(text, other) { if (other) return other(); return function () { return text; }; } var first = make(unseen("+")), second = make("-", first); return eval("(function (a, b) { return a " + second + " b; })")(7, 3); },
  "an earlier iteration"() { var first; for (let row of [["+"], ["-"]]) { if (!first) first = function () { return row[0]; }; } return eval("(function (a, b) { return a " + first() + " b; })")(7, 3); },
  "a variable named arguments"() { var arguments; return eval("(function () { return " + (arguments === undefined ? 1 : 2) + "; })")(); },
  "a proven array"() { var rows = []; ["add", "sub"].forEach(function (name) { rows.push(["+", name]); }); rows = rows.map(row => [row[0], row[1] + "2"]); var out = ""; for (var row of rows) { const made = eval("(function " + row[1] + "(a, b) { return a " + row[0] + " b; })"); out += made.name + made(7, 3); } return out; },
};
for (let turn = 0; turn < 3; turn++) {
  for (const name of Object.keys(tests)) {
    try { say(name, turn, tests[name]("z")); } catch (error) { say(name, turn, error.name); }
  }
}
console.log(log.join("\n"));
