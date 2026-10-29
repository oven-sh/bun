// `proxy.name` in code that runs once, and where several names of one object are read side by side. Side by side, the trap of a plain handler is
// called straight from compiled code. What the language demands of the trap's answer holds in both.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
// Env: JSC_aotCountsPath=/dev/null
const counts = typeof aotOperationCount === "function" && aotOperationCount("operationAOTGetByIdAndCache") !== null;
const count = counts ? aotOperationCount : () => 0;
function trapLookups() { return count("operationAOTGetWithProxyTrap") + count("operationAOTValidateAnswerOfProxyTrap"); }
function genericReads() { return count("operationAOTGetByIdAndCache") + count("operationAOTGetById") + count("operationAOTGetGeneric"); }
var seen = [];
var atTop = new Proxy({ held: 1 }, { get(t, key, receiver) { seen.push(key + (receiver === atTop ? "" : " with another receiver") + (this.get ? "" : " with another this")); return "top " + key; } });
var tops = [atTop.first, atTop.second, atTop.third, atTop.held, atTop.constructor];
console.log(tops.join(" | "), "|", seen.join(" "));

function several(o) { return o.alpha + " " + o.beta + " " + o.gamma + " " + o.delta + " " + o.epsilon; }
function destructured(o) { var { alpha, beta, gamma } = o; return alpha + " " + beta + " " + gamma; }
function inLoop(list) { var text = ""; for (var i = 0; i < list.length; i++) { var o = list[i]; text += o.alpha + o.beta + o.gamma; } return text.length; }
var plain = { alpha: "a", beta: "b", gamma: "c", delta: "d", epsilon: "e" };
for (var i = 0; i < 50; i++) { several(plain); destructured(plain); inLoop([plain, plain]); }
var trapped = new Proxy(plain, { get(t, key) { return "<" + t[key] + ">"; } });
var lookupsBefore = trapLookups(), genericReadsBefore = genericReads();
var answers = [];
for (var i = 0; i < 50; i++) answers = [several(trapped), destructured(trapped), inLoop([trapped, plain, trapped])];
// The stub reads the trap off the handler at each read of the proxy and calls it. A few reads of other objects enter the generic operations.
var lookups = trapLookups() - lookupsBefore, passedOn = genericReads() - genericReadsBefore;
console.log(answers.join(" | "), "|", !counts || (lookups === 0 && passedOn <= 15));

function attempt(label, work) { var answer; try { answer = String(work()); } catch (error) { answer = "threw " + error.constructor.name + ": " + error.message; } console.log(label + ": " + answer); }
var fixed = Object.freeze({ alpha: 1, beta: 2, gamma: 3, delta: 4, epsilon: 5 });
attempt("a frozen target, the same", function () { return several(new Proxy(fixed, { get(t, key) { return t[key]; } })); });
attempt("a frozen target, another", function () { return several(new Proxy(fixed, { get(t, key) { return key === "delta" ? 0 : t[key]; } })); });
attempt("the trap throws at the third", function () { return several(new Proxy(plain, { get(t, key) { if (key === "gamma") throw new RangeError("no gamma"); return t[key]; } })); });
attempt("no trap", function () { return several(new Proxy(plain, {})); });
attempt("revoked", function () { var made = Proxy.revocable(plain, {}); made.revoke(); return several(made.proxy); });
attempt("revoked by the second read", function () { var made = Proxy.revocable(plain, { get(t, key) { if (key === "beta") made.revoke(); return t[key]; } }); return several(made.proxy); });
attempt("a function as the target", function () { function f() {} f.alpha = 1; return several(new Proxy(f, { get(t, key) { return key in t ? t[key] : key; } })); });
attempt("the name, the length and the prototype of a function", function () { function f(a, b) {} var p = new Proxy(f, { get(t, key) { return t[key]; } }); return p.name + " " + p.length + " " + typeof p.prototype; });
attempt("another name for a function", function () { function f(a, b) {} var p = new Proxy(f, { get(t, key) { return "other"; } }); return p.name + " " + p.length; });
attempt("another prototype for a class", function () { class C {} var p = new Proxy(C, { get(t, key) { return "other"; } }); return p.name + " " + p.prototype; });
attempt("another prototype for a function", function () { function f() {} var p = new Proxy(f, { get(t, key) { return "other"; } }); return String(p.prototype); });
function place(error) {
  var lines = String(error.stack).split("\n").filter(function (line) { return /proxy-read-run-once-or-multi-name/.test(line); });
  return lines.slice(0, 3).map(function (line) { var found = /(\d+:\d+)\)?$/.exec(line); return found ? found[1] : "?"; }).join(" < ");
}
try { several(new Proxy(plain, { get(t, key) { if (key === "delta") throw new Error("thrown by the trap"); return 1; } })); } catch (error) { console.log(error.message, "at", place(error)); }
try { several(new Proxy(fixed, { get(t, key) { return 0; } })); } catch (error) { console.log(error.constructor.name, "at", place(error)); }
// The code above that runs once asks the run time, so not every count is zero.
console.log("the run time was asked in the end:", !counts || trapLookups() + genericReads() > 0);
