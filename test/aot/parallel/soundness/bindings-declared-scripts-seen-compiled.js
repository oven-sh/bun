// A script run in this realm declares let, const, class, var and function bindings under names of its own. Compiled code reads, writes and calls them by name as plain code does.
const vm = require("node:vm");
const rows = [];
function say(label, f) {
  try {
    rows.push(label + ": " + f());
  } catch (e) {
    rows.push(label + ": threw " + e.name);
  }
}
function readLate() { return typeof lateName + " " + (typeof lateName === "undefined" ? "-" : lateName); }
function writeLate(v) { lateName = v; return lateName; }
say("before", readLate);
say("declare let", () => vm.runInThisContext("let lateName = 1; typeof lateName"));
say("after", readLate);
say("write", () => writeLate(2));
say("script sees the write", () => vm.runInThisContext("lateName"));
say("not on globalThis", () => "lateName" in globalThis);
say("declare const", () => vm.runInThisContext("const fixedName = { n: 1 }; 0"));
say("read const", () => fixedName.n);
say("write const", () => { fixedName = 5; return "written"; });
say("declare class", () => vm.runInThisContext("class LateClass { constructor(x) { this.x = x; } twice() { return this.x * 2; } } 0"));
say("use class", () => { const made = new LateClass(4); return made.twice() + " " + (made instanceof LateClass) + " " + made.constructor.name; });
say("declare twice", () => vm.runInThisContext("let lateName = 3"));
say("dead zone", () => vm.runInThisContext("deadName; let deadName = 1"));
say("read after a failed script", () => typeof deadName);
say("read it", () => deadName);
say("var", () => vm.runInThisContext("var varName = 7; 0") + " " + varName + " " + ("varName" in globalThis) + " " + globalThis.varName);
say("function", () => vm.runInThisContext("function scriptFunction(a) { return a + 1; } 0") + " " + scriptFunction(1) + " " + typeof globalThis.scriptFunction);
say("let over var", () => vm.runInThisContext("let varName = 8"));
say("global property then let", () => { globalThis.ownName = "property"; const before = ownName; vm.runInThisContext("let ownName = 'binding'"); return before + " " + ownName + " " + globalThis.ownName; });
say("delete the property", () => { delete globalThis.ownName; return ownName; });
say("script reads the program's global", () => { globalThis.shared = [1, 2]; return vm.runInThisContext("shared.push(3); shared.length") + " " + shared.join(); });
say("closure over a script binding", () => { vm.runInThisContext("let counter = 0; function bump() { return ++counter; }"); bump(); return bump() + " " + counter; });
say("Script object twice", () => { const s = new vm.Script("typeof againName === 'undefined' ? 'free' : againName"); const first = s.runInThisContext(); vm.runInThisContext("let againName = 'bound'"); return first + " " + s.runInThisContext(); });
console.log(rows.join("\n"));
