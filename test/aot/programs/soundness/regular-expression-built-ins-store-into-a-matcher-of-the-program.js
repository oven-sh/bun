// Built-ins of regular expressions store lastIndex into a matcher that is no RegExp: an instance of a class of the program.
class Matcher { lastIndex = 5; flags = "g"; global = true; unicode = false; calls = 0; exec(s) { this.calls++; if (this.calls > 2) return null; const r = [""]; r.index = 0; return r; } read() { return this.lastIndex + 1; } }
{ const m = new Matcher(); class R extends RegExp { static get [Symbol.species]() { return function () { return m; }; } } const it = "aaa".matchAll(new R("a", "g")); const before = m.read(); const n = [...it].length; console.log("matchAll", before, n, m.read(), m.lastIndex, m.calls); }
{ const m = new Matcher(); console.log("match", String(RegExp.prototype[Symbol.match].call(m, "aaa")), m.read(), m.lastIndex); }
{ const m = new Matcher(); console.log("replace", RegExp.prototype[Symbol.replace].call(m, "aaa", "x"), m.read(), m.lastIndex); }
{ const m = new Matcher(); console.log("search", RegExp.prototype[Symbol.search].call(m, "aaa"), m.read(), m.lastIndex); }
{ const m = new Matcher(); m.constructor = { [Symbol.species]: function () { return m; } }; console.log("split", RegExp.prototype[Symbol.split].call(m, "aaa").length, m.read(), m.lastIndex); }
{ const m = new Matcher(); console.log("test", RegExp.prototype.test.call(m, "aaa"), m.read(), m.lastIndex); }
{ const m = { lastIndex: "start", exec() { return null; }, flags: "", global: false }; console.log("search literal", RegExp.prototype[Symbol.search].call(m, "a"), typeof m.lastIndex, m.lastIndex); }
