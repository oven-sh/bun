var names = JSON.parse('["callee", "length", "0"]');
var kept = null;
function say(name, run) { var said; try { said = run(); } catch (e) { said = "threw " + e.name; } console.log(name + ": " + String(said)); }
function shape(x) { return typeof x === "string" ? "text " + x : x + 1; }

function byName() { if (arguments[1]) return arguments.callee("by name", false); return shape(arguments[0]); }
function byKey() { if (arguments[1]) return arguments[names[0]]("by key", false); return shape(arguments[0]); }
function relay(a) { return a.callee("relayed", false); }
function handedOn() { if (arguments[1]) return relay(arguments); return shape(arguments[0]); }
function relayByKey(a, k) { return a[k]("relayed by key", false); }
function handedOnByKey() { if (arguments[1]) return relayByKey(arguments, names[0]); return shape(arguments[0]); }
function described() { if (arguments[1]) return Object.getOwnPropertyDescriptor(arguments, "callee").value("described", false); return shape(arguments[0]); }
function describedAll() { if (arguments[1]) return Object.getOwnPropertyDescriptors(arguments).callee.value("described all", false); return shape(arguments[0]); }
function reflected() { if (arguments[1]) return Reflect.get(arguments, "callee")("reflected", false); return shape(arguments[0]); }
function destructured() { if (arguments[1]) { var { callee } = arguments; return callee("destructured", false); } return shape(arguments[0]); }
function storedAway() { if (arguments[1]) { kept = arguments; return "kept"; } return shape(arguments[0]); }
function inAList() { if (arguments[1]) { var list = [arguments]; return list[0].callee("in a list", false); } return shape(arguments[0]); }
function inAnObject() { if (arguments[1]) { var o = { a: arguments }; return o.a.callee("in an object", false); } return shape(arguments[0]); }
function throughApply() { if (arguments[1]) return relay.apply(null, [arguments]); return shape(arguments[0]); }
function throughCall() { if (arguments[1]) return relay.call(null, arguments); return shape(arguments[0]); }
function throughBind() { if (arguments[1]) return relay.bind(null, arguments)(); return shape(arguments[0]); }
function throughArrow() { if (arguments[1]) return (() => arguments.callee("through an arrow", false))(); return shape(arguments[0]); }
function throughOwnKeys() { if (arguments[1]) { var a = arguments, out = ""; Reflect.ownKeys(a).forEach(function (k) { if (typeof a[k] === "function" && typeof k === "string") out += a[k]("own key " + k, false); }); return out; } return shape(arguments[0]); }
function throughReturn() { if (arguments[1]) return arguments; return shape(arguments[0]); }
function throughThrow() { if (arguments[1]) throw arguments; return shape(arguments[0]); }
function throughMap() { if (arguments[1]) { var m = new Map(); m.set("a", arguments); return m.get("a").callee("through a map", false); } return shape(arguments[0]); }
function throughPromise() { if (arguments[1]) return Promise.resolve(arguments).then(function (a) { console.log("throughPromise later: " + a.callee("through a promise", false)); }) && "asked"; return shape(arguments[0]); }
function asThis() { if (arguments[1]) return (function () { return this.callee("as this", false); }).call(arguments); return shape(arguments[0]); }
function copied() { if (arguments[1]) { var o = Object.create(arguments); return o.callee("from below", false); } return shape(arguments[0]); }

for (var turn = 0; turn < 3; turn++) {
  say("throughPromise", function () { return throughPromise(turn, false) + " | " + throughPromise(turn, true); });
}
