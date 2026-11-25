class Held { #kept = 1; static read(o) { try { return o.#kept; } catch { return "none"; } } }
class Two { #a = 1; #b = [2]; constructor(b) { if (b) this.#b = b; } }
class Deep extends Two { #c = 3; }
const log = [];
const trap = name => ({ getPrototypeOf(t) { log.push(name + " proto"); return Reflect.getPrototypeOf(t); }, ownKeys(t) { log.push(name + " keys"); return Reflect.ownKeys(t); }, get(t, k, r) { log.push(name + " get " + String(k)); return Reflect.get(t, k, r); }, has(t, k) { log.push(name + " has " + String(k)); return Reflect.has(t, k); } });
const above = (made, name) => Object.create(new Proxy(Object.create(made), trap(name)));
const say = (l, f) => { log.length = 0; let r; try { r = f(); } catch (e) { r = e.name + " " + e.message.slice(0, 60); } console.log(l, r, log.join(", ")); };
say("pattern", () => Bun.deepMatch(above(new Held(), "p"), new Held()));
say("object", () => Bun.deepMatch(new Held(), above(new Held(), "o")));
say("both", () => Bun.deepMatch(above(new Held(), "p"), above(new Held(), "o")));
say("two levels", () => Bun.deepMatch(above(above(new Held(), "q"), "p"), new Held()));
say("itself a proxy", () => Bun.deepMatch(new Proxy(new Held(), trap("p")), new Held()));
say("lists", () => Bun.deepMatch(Object.setPrototypeOf([1], new Proxy(Array.prototype, trap("p"))), [1]));
say("lists two", () => Bun.deepMatch([above(new Two(), "p")], [above(new Two(), "o")]));
say("plain two", () => [Bun.deepMatch(new Two(), new Two()), Bun.deepMatch(new Two([2]), new Two([3])), Bun.deepMatch(new Deep(), new Deep()), Bun.deepMatch(new Two(), new Deep()), Bun.deepMatch(new Deep(), new Two())]);
say("null prototype", () => Bun.deepMatch(Object.create(null), new Held()));
say("plain object", () => [Bun.deepMatch({ a: 1 }, { a: 1, b: 2 }), Bun.deepMatch({ a: 1, b: 2 }, { a: 1 }), Bun.deepMatch([1, 2], [1, 2]), Bun.deepMatch([1], [1, 2])]);
say("throws", () => Bun.deepMatch(Object.create(new Proxy({}, { getPrototypeOf() { throw new RangeError("no"); } })), new Held()));
class List extends Array { #x = 1; }
say("list class", () => [Bun.deepMatch(List.of(1, 2), List.of(1, 2)), Bun.deepMatch(List.of(1), [1]), Bun.deepMatch([1], List.of(1))]);
