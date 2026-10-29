// Properties read through a Proxy, by a written name and by a computed key: the trap sees the target, the key and the receiver; a handler
// without the trap passes the read on; what the language demands of the trap's answer is demanded; and the lookup in the runtime goes
// straight to the proxy's own way of reading.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
function counted() { return count("operationAOTGetByIdAndCache") > 0; }
var log = [];
function note(text) { log.push(text); }
function flush(label) { console.log(label + ": " + log.join(" ")); log = []; }
function show(value) { return typeof value === "symbol" ? String(value) : typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value === "string" ? JSON.stringify(value) : String(value); }
function byName(o) { return o.wanted; }
function byOtherName(o) { return o.other; }
function byKey(o, key) { return o[key]; }
function method(o) { return o.method(1, 2); }
function attempt(label, work) { var answer; try { answer = show(work()); } catch (error) { answer = "threw " + error.constructor.name + ": " + (/is not a function/.test(error.message) ? "it is not a function" : /class constructor/.test(error.message) ? "a class constructor is not called" : error.message); } note("=> " + answer); flush(label); }
var own = Symbol("own");
function readAll(label, make) {
  attempt(label + " .wanted", function () { return byName(make()); });
  attempt(label + " .other", function () { return byOtherName(make()); });
  attempt(label + ' ["wanted"]', function () { return byKey(make(), "wanted"); });
  attempt(label + ' ["wan" + "ted"]', function () { return byKey(make(), "wan" + String("ted")); });
  attempt(label + " [symbol]", function () { return byKey(make(), own); });
  attempt(label + " [3]", function () { return byKey(make(), 3); });
  attempt(label + ' ["3"]', function () { return byKey(make(), "3"); });
  attempt(label + " .method()", function () { return method(make()); });
}
function target() { var o = { wanted: "of the target", other: 2, method(a, b) { return "method of " + (this === o ? "the target" : "another") + " " + (a + b); }, 3: "three" }; o[own] = "by a symbol"; return o; }
function telling(extra) {
  return Object.assign({ get(t, key, receiver) { note("get " + String(key) + " " + typeof key + (receiver === this.proxy ? " receiver is the proxy" : " receiver is another")); return Reflect.get(t, key, receiver); } }, extra);
}
readAll("a trap", function () { var handler = telling(); return handler.proxy = new Proxy(target(), handler); });
readAll("no trap", function () { return new Proxy(target(), {}); });
readAll("the trap is undefined", function () { return new Proxy(target(), { get: undefined }); });
readAll("the trap is null", function () { return new Proxy(target(), { get: null }); });
readAll("the trap is no function", function () { return new Proxy(target(), { get: 5 }); });
readAll("the trap is inherited", function () { return new Proxy(target(), Object.create({ get(t, key) { note("inherited trap " + String(key)); return "from the inherited trap"; } })); });
readAll("the trap is behind a getter", function () { return new Proxy(target(), { get get() { note("the handler is asked"); return function (t, key) { return "from the trap behind a getter"; }; } }); });
readAll("the trap throws", function () { return new Proxy(target(), { get(t, key) { throw new RangeError("no " + String(key)); } }); });
readAll("a bound trap", function () { return new Proxy(target(), { get: function (prefix, t, key) { return prefix + String(key); }.bind(null, "bound ") }); });
readAll("an arrow as the trap", function () { return new Proxy(target(), { get: (t, key) => "arrow " + String(key) }); });
readAll("a host function as the trap", function () { return new Proxy(target(), { get: Reflect.get }); });
readAll("a class as the trap", function () { return new Proxy(target(), { get: class {} }); });
readAll("a callable proxy as the trap", function () { return new Proxy(target(), { get: new Proxy(function (t, key) { return "through two " + String(key); }, {}) }); });
readAll("a trap with fewer parameters", function () { return new Proxy(target(), { get() { return arguments.length + " arguments, this is " + (typeof this.get); } }); });
readAll("a trap with more parameters", function () { return new Proxy(target(), { get(t, key, receiver, more) { return String(more); } }); });
readAll("a sloppy trap", function () { return new Proxy(target(), { get: function () { return this === undefined ? "no this" : typeof this; } }); });
readAll("a handler with a class", function () { class Handler { get(t, key) { return "of a class " + String(key); } } return new Proxy(target(), new Handler); });
readAll("a frozen handler", function () { return new Proxy(target(), Object.freeze({ get(t, key) { return "frozen " + String(key); } })); });
readAll("a handler with many properties", function () { var handler = {}; for (var i = 0; i < 80; i++) handler["filler" + i] = i; handler.get = function (t, key) { return "far " + String(key); }; return new Proxy(target(), handler); });
readAll("the trap is replaced", function () { var handler = { get(t, key) { handler.get = function () { return "the second trap"; }; return "the first trap"; } }; var made = new Proxy(target(), handler); made.wanted; return made; });
readAll("the trap is deleted", function () { var handler = { get(t, key) { delete handler.get; return "the trap"; } }; var made = new Proxy(target(), handler); made.wanted; return made; });
readAll("a proxy of a proxy", function () { var inner = telling(), outer = telling(); inner.proxy = new Proxy(target(), inner); return outer.proxy = new Proxy(inner.proxy, outer); });
readAll("a proxy as the handler", function () { return new Proxy(target(), new Proxy({}, { get(t, key) { note("the handler's handler is asked for " + String(key)); return undefined; } })); });
readAll("revoked", function () { var made = Proxy.revocable(target(), {}); made.revoke(); return made.proxy; });
readAll("revoked by its trap", function () { var made = Proxy.revocable(target(), { get(t, key) { made.revoke(); return "last answer"; } }); return made.proxy; });
readAll("a function as the target", function () { function f() {} f.wanted = "of a function"; return new Proxy(f, { get(t, key) { note("get " + String(key)); return t[key]; } }); });
readAll("an array as the target", function () { var a = [0, 1, 2, "at three"]; a.wanted = "of an array"; return new Proxy(a, telling()); });
readAll("getters of the target", function () { var made = new Proxy({ get wanted() { return this === made ? "this is the proxy" : "this is the target"; } }, {}); return made; });
readAll("inheriting from a proxy", function () { var handler = telling(); var child = Object.create(handler.proxy = new Proxy(target(), handler)); child.other = "own"; return child; });

function fixed(descriptor) { var o = {}; Object.defineProperty(o, "wanted", descriptor); return o; }
attempt("fixed value, the same answer", function () { return byName(new Proxy(fixed({ value: 1 }), { get() { return 1; } })); });
attempt("fixed value, another answer", function () { return byName(new Proxy(fixed({ value: 1 }), { get() { return 2; } })); });
attempt("fixed value NaN, NaN", function () { return byName(new Proxy(fixed({ value: NaN }), { get() { return NaN; } })); });
attempt("fixed value 0, -0", function () { return byName(new Proxy(fixed({ value: 0 }), { get() { return -0; } })); });
attempt("writable, another answer", function () { return byName(new Proxy(fixed({ value: 1, writable: true }), { get() { return 2; } })); });
attempt("configurable, another answer", function () { return byName(new Proxy(fixed({ value: 1, configurable: true }), { get() { return 2; } })); });
attempt("fixed setter alone, undefined", function () { return byName(new Proxy(fixed({ set(v) {} }), { get() { return undefined; } })); });
attempt("fixed setter alone, an answer", function () { return byName(new Proxy(fixed({ set(v) {} }), { get() { return 2; } })); });
attempt("fixed getter, another answer", function () { return byName(new Proxy(fixed({ get() { return 1; } }), { get() { return 2; } })); });
attempt("the trap fixes the property to another value", function () { return byName(new Proxy({}, { get(t) { Object.defineProperty(t, "wanted", { value: 1 }); return 2; } })); });
attempt("the trap fixes the property to its answer", function () { return byName(new Proxy({}, { get(t) { Object.defineProperty(t, "wanted", { value: 2 }); return 2; } })); });
attempt("the trap frees the property", function () { var t = {}; Object.defineProperty(t, "wanted", { value: 1, configurable: true }); return byName(new Proxy(t, { get(t) { delete t.wanted; return 2; } })); });
attempt("the trap reads the proxy again for ever", function () { return byName(new Proxy({}, { get(t, key, receiver) { return receiver.wanted; } })); });
attempt("frozen target, by key", function () { return byKey(new Proxy(Object.freeze({ wanted: 1 }), { get() { return 2; } }), "wanted"); });

// One site: proxies and plain objects by turns.
var mixed = [{ wanted: "plain" }, new Proxy({}, { get() { return "trapped"; } }), Object.create({ wanted: "inherited" }), new Proxy({ wanted: "passed on" }, {}), {}, "text"];
var turns = [];
for (var round = 0; round < 3; round++) for (var each of mixed) turns.push(byName(each));
console.log(turns.join(" "));

var calls = 0;
var busy = new Proxy({}, { get(t, key) { calls++; return key; } });
function straight() { return count("operationAOTGetById") + count("operationAOTGetByIdAndCache") + count("operationAOTGetGeneric") + count("operationAOTGetWithProxyTrap") + count("operationAOTValidateAnswerOfProxyTrap"); }
var before = straight();
for (var i = 0; i < 500; i++) { byName(busy); byOtherName(busy); }
console.log(calls, !counted() || straight() - before <= 10);
var plain = { wanted: 1, other: 2 };
function forProxies() { return count("operationAOTGetWithProxyTrap") + count("operationAOTValidateAnswerOfProxyTrap"); }
before = forProxies();
for (var i = 0; i < 500; i++) { byName(plain); byOtherName(plain); }
console.log(forProxies() - before);

function place(error) {
  var lines = String(error.stack).split("\n").filter(function (line) { return /properties-through-proxies/.test(line); });
  return lines.slice(0, 3).map(function (line) { var found = /(\d+:\d+)\)?$/.exec(line); return found ? found[1] : "?"; }).join(" < ");
}
for (var reader of [byName, byOtherName]) {
  try { reader(new Proxy({}, { get() { throw new Error("thrown by the trap"); } })); } catch (error) { console.log(reader.name, error.message, "at", place(error)); }
  try { var gone = Proxy.revocable({}, {}); gone.revoke(); reader(gone.proxy); } catch (error) { console.log(reader.name, error.constructor.name, "at", place(error)); }
}
