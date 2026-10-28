// What the function is handed in place of an ordinary class.
const lines = [];
const attempt = (run) => { try { const result = run(); return typeof result === "function" ? "a function" : String(result); } catch (error) { return error.constructor.name; } };
const Mix = (Parent) => class extends Parent { mixed = "m"; #h = 1; static has(o) { return #h in o; } hello() { return "mix>" + (typeof super.hello === "function" ? super.hello() : "none"); } };
const reads = [];
const Watched = new Proxy(class { hello() { return "watched"; } }, { get(target, key, receiver) { reads.push(String(key)); return Reflect.get(target, key, receiver); }, construct(target, list, newTarget) { reads.push("construct"); return Reflect.construct(target, list, newTarget); } });
function Old() { this.old = 1; } Old.prototype.hello = function () { return "old"; };
class Plain { hello() { return "plain"; } }
const Bound = Plain.bind(null);
let N; lines.push(attempt(() => { N = Mix(null); return typeof N; }), attempt(() => new N()), attempt(() => Object.getPrototypeOf(N.prototype)), attempt(() => Object.getPrototypeOf(N) === Function.prototype));
lines.push(attempt(() => Mix(undefined)), attempt(() => Mix(1)), attempt(() => Mix({})), attempt(() => Mix(() => {})), attempt(() => Mix(function* () { })), attempt(() => Mix(async function () { })), attempt(() => Mix(Symbol)), attempt(() => new (Mix(Symbol))()));
const NoPrototype = function () { }; NoPrototype.prototype = 3; lines.push(attempt(() => Mix(NoPrototype)));
const NullPrototype = function () { }; NullPrototype.prototype = null; lines.push(attempt(() => Object.getPrototypeOf(Mix(NullPrototype).prototype)), attempt(() => Object.keys(new (Mix(NullPrototype))()).join()));
const W1 = Mix(Watched); lines.push(reads.join()); reads.length = 0; lines.push(new W1().hello(), reads.join());
lines.push(attempt(() => Mix(Bound)));
const M = { Old: Mix(Old), Array: Mix(Array), Map: Mix(Map), Error: Mix(Error), Promise: Mix(Promise), Object: Mix(Object), Function: Mix(Function), RegExp: Mix(RegExp), Date: Mix(Date), Uint8Array: Mix(Uint8Array), Boolean: Mix(Boolean) };
for (const [name, C] of Object.entries(M)) lines.push(name + " " + attempt(() => { const o = name === "Promise" ? new C(() => { }) : new C(); return [o.mixed, C.has(o), o.hello(), Object.keys(o).join("/"), Object.prototype.toString.call(o), o instanceof C, Object.values(M).filter((X) => X.has(o)).length].join(); }));
lines.push(attempt(() => { const a = new M.Array(3); a.push(1); return a.length + ":" + a.mixed + ":" + Array.isArray(a) + a.map((x) => x).mixed; }), attempt(() => new M.Error("text").message + new M.Error("x").stack.split("\n")[0]), attempt(() => new M.Map([[1, 2]]).get(1)));
M.Promise.resolve(5).then((v) => { console.log(lines.join("\n")); console.log("resolved " + v); });
