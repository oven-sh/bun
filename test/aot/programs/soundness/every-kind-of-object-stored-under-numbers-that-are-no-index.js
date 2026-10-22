// A store under a number that is no array index adds a property to whatever kind of object takes it (a typed array swallows it), and every listing of the keys shows it.
const rows = [];
function put(o, k, v) { try { o[k] = v; } catch (e) { return e.name; } return o[k]; }
function list(o) { let names = ""; for (const name in o) names += name + ";"; return Object.keys(o).join() + " | " + names + " | " + Reflect.ownKeys(o).map(String).join() + " | " + JSON.stringify(Object.entries(o)); }
function tell(label, o) {
  const got = [put(o, -1, "minus"), put(o, 1.5, "half"), put(o, 2, "two"), put(o, 4294967295, "big")];
  rows.push(label + ": " + got.join() + " | " + list(o) + " | " + (-1 in o) + " " + (1.5 in o) + " " + Object.hasOwn(o, "-1") + " " + o["-1"] + " " + o[-1]);
}
tell("function", function () {});
tell("arrow", () => {});
tell("map", new Map());
tell("set", new Set());
tell("regexp", /x/);
tell("date", new Date(0));
tell("error", new RangeError("m"));
tell("promise", Promise.resolve(1));
tell("literal", { a: 1 });
tell("instance", new (class P { x = 1; })());
tell("no prototype", Object.create(null));
tell("typed array", new Uint8Array(4));
tell("float array", new Float64Array(1));
tell("array buffer", new ArrayBuffer(2));
tell("boxed string", new String("abcd"));
tell("boxed number", new Number(5));
tell("generator", (function* () {})());
tell("bound", function () {}.bind(null));
tell("class", class Q {});
tell("array subclass", new (class R extends Array {})(1));
tell("weak map", new WeakMap());
tell("symbol object", Object(Symbol.iterator));
console.log(rows.join("\n"));
