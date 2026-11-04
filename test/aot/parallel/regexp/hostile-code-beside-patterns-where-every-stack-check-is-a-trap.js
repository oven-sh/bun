// Env: BUN_JSC_forceTrapAwareStackChecks=1
// The build goes through the code that leads to a call of RegExp, in a realm of its own. It goes both ways where it cannot know which is taken, so it meets all of this. No run does: `never` is false.
// The build has to end, with the same bytes each time, and may ask nothing of the world outside the program.
const never = process.argv.length > 100;
const log = [];
function pattern(text) { return new RegExp(text + String("+$")); }

function loops() { let n = 0; if (never) while (true) n++; return pattern("a" + n); }
function recurses(n) { return never ? recurses(n + 1) : pattern("b" + n); }
function keepsAllocating() { const kept = []; if (never) while (true) kept.push(new Array(1000000).fill(0)); return pattern("c" + kept.length); }
function doubles() { let list = [1], text = "x"; if (never) while (true) { list = list.concat(list); text += text; } return pattern("d" + list.length + text); }
function repeats() { return pattern("e" + (never ? "x".repeat(2 ** 30).length : 0)); }
function throws() { if (never) throw new Error("no"); return pattern("f"); }
function catches() { try { if (never) null.x; return pattern("g"); } catch { return pattern("h"); } }
const holder = { get text() { log.push("the getter ran"); return "i"; } };
function reads() { return pattern(holder.text); }
function asksTheWorld() {
  const parts = never ? [Date.now(), new Date().getFullYear(), Math.random(), process.env.HOME, require("fs").readFileSync("/etc/hostname", "utf8"), performance.now(), "x".toLocaleUpperCase()] : ["j"];
  return parts.map(part => pattern(String(part)));
}
function backtracks() { let found = false; if (never) while (true) found = /(a+)+$/.test("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!"); return pattern("k" + found); }
function sorts() { const list = never ? new Array(1000000).fill(0) : [2, 1]; if (never) while (true) list.sort(); return pattern("l" + list.sort().join("")); }

const made = [loops(), recurses(0), keepsAllocating(), doubles(), repeats(), throws(), catches(), reads(), ...asksTheWorld(), backtracks(), sorts()];
console.log(made.map(String).join(" "));
console.log(made.map(one => one.test(one.source.slice(0, -2))).join(), log.join());
