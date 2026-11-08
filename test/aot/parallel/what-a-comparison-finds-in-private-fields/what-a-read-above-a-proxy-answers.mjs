// Guards: a private field of a compiled class that lies above a proxy on the pattern's chain is listed and read as undefined, whatever it holds; below the proxy it is read as it is.
class Held { #kept = 1; static read(o) { try { return o.#kept; } catch { return "none"; } } }
class Empty { #nothing; }
class Other { #more = 2; }
function handBack(o) { return o; }
class Stamp extends handBack { #stamped = 3; constructor(o) { super(o); } }
const above = (made, handler = {}) => Object.create(new Proxy(Object.create(made), handler));
const say = (name, f) => { try { console.log(name, f()); } catch (e) { console.log(name, "throws", e.name, e.message.slice(0, 70)); } };
say("pattern above one proxy", () => Bun.deepMatch(above(new Held()), new Held()));
say("pattern above two proxies", () => Bun.deepMatch(above(above(new Held())), new Held()));
say("the pattern is the proxy", () => Bun.deepMatch(new Proxy(new Held(), {}), new Held()));
say("the pattern is the proxy, object without", () => Bun.deepMatch(new Proxy(new Held(), {}), {}));
say("a field that holds undefined", () => Bun.deepMatch(above(new Empty()), new Empty()));
say("a field that holds undefined, object without", () => Bun.deepMatch(above(new Empty()), {}));
say("stamped below, held above", () => Bun.deepMatch(new Stamp(above(new Held())), new Stamp(new Held())));
say("stamped below, nothing above", () => Bun.deepMatch(new Stamp(above({})), new Stamp({})));
say("held below and above", () => { const low = Object.create(new Held()); Object.setPrototypeOf(Object.getPrototypeOf(low), new Proxy(new Held(), {})); return Bun.deepMatch(low, new Held()); });
say("two classes, one on each side", () => { const low = Object.create(new Other()); Object.setPrototypeOf(Object.getPrototypeOf(low), new Proxy(Object.create(new Held()), {})); class Both extends handBack { constructor(o) { super(o); } } return [Bun.deepMatch(low, new Other()), Bun.deepMatch(low, new Held())].join(); });
say("no proxy", () => Bun.deepMatch(Object.create(new Held()), new Held()));
say("object above a proxy", () => Bun.deepMatch(new Held(), above(new Held())));
say("both above proxies", () => Bun.deepMatch(above(new Held()), above(new Held())));
say("a get trap is not asked", () => { let asked = 0; const r = Bun.deepMatch(above(new Held(), { get(t, k, r) { asked++; return Reflect.get(t, k, r); } }), new Held()); return r + " " + asked; });
say("in a list", () => Bun.deepMatch([above(new Held())], [new Held()]));
say("in a field", () => Bun.deepMatch({ inner: above(new Held()) }, { inner: new Held() }));
say("equals", () => [Bun.deepEquals(above(new Held()), above(new Held())), Bun.deepEquals(above(new Held()), new Held()), Bun.deepEquals(above(new Held()), above(new Held()), true)].join());
