// Object.entries hands out texts and the own values of the object: whatever is done with the pairs is done to the values themselves.
class Vector { constructor(x) { this.x = x; } add(other) { return this.x + other.x; } }
const lines = [];
function say(...values) { lines.push(values.join(" ")); }
function sum(object) { let total = 0; for (const [key, value] of Object.entries(object)) total += value.add(value) + key.length; return total; }
say("loop", sum({ a: new Vector(1), bb: new Vector(2) }));
function storeThroughPair(object) { for (const [, value] of Object.entries(object)) value.x = "t" + value.x; }
const kept = { a: new Vector(3), b: new Vector(4) };
say("before", kept.a.x + 1, kept.b.x * 2);
storeThroughPair(kept);
say("behind", kept.a.x + 1, kept.b.x + 2);
const pairs = Object.entries({ a: new Vector(5) });
pairs[0][1] = new Vector(6);
say("pair written", pairs[0][1].x, pairs[0].length);
pairs[0].push(7);
say("pair longer", pairs[0].length, pairs[0][2]);
pairs[0][0] = 8;
say("key written", pairs[0][0] + 1);
const withGetter = { get a() { return new Vector(9); }, b: new Vector(10) };
say("getter", sum(withGetter));
const proxied = new Proxy({ a: new Vector(1) }, { get(target, key) { return key === "a" ? new Vector(11) : target[key]; }, ownKeys() { return ["a", "c"]; }, getOwnPropertyDescriptor() { return { value: 1, enumerable: true, configurable: true }; } });
try { say("proxy", sum(proxied)); } catch (error) { say("proxy threw", error.constructor.name); }
const mixed = { a: new Vector(1), b: "text", c: 3, d: null, e: undefined, f: [new Vector(2)], g: () => 4 };
for (const [key, value] of Object.entries(mixed)) say("mixed", key, typeof value, value instanceof Vector ? value.add(value) : Array.isArray(value) ? value[0].x : typeof value === "function" ? value() : value);
say("text", JSON.stringify(Object.entries("ab")), JSON.stringify(Object.entries(5)));
say("list", JSON.stringify(Object.entries([new Vector(1), , new Vector(2)])));
const symbol = Symbol("s");
const hidden = { [symbol]: new Vector(1), seen: new Vector(2) };
Object.defineProperty(hidden, "hidden", { value: new Vector(3), enumerable: false });
say("hidden", Object.entries(hidden).length, Object.entries(hidden)[0][1].x);
say("instance", JSON.stringify(Object.entries(new Vector(12))));
const bare = Object.create(null);
bare.a = new Vector(13);
say("bare", sum(bare));
try { Object.entries(null); } catch (error) { say("null", error.constructor.name); }
const grown = { a: new Vector(1) };
for (const [key, value] of Object.entries(grown)) { grown["b" + key] = new Vector(20); value.x = 15; }
say("grown", Object.keys(grown).join(), grown.a.x, grown.ba.x);
const byKey = Object.fromEntries(Object.entries({ a: new Vector(1), b: new Vector(2) }).map(([key, value]) => [key + "2", new Vector(value.x * 10)]));
say("from", byKey.a2.x, byKey.b2.x);
say("sorted", Object.entries({ b: new Vector(1), a: new Vector(0) }).sort(([, one], [, other]) => one.x - other.x).map(([key]) => key).join());
say("reduced", Object.entries({ a: new Vector(1), b: new Vector(2) }).reduce((total, [, value]) => total + value.x, 0));
const asMap = new Map(Object.entries({ a: new Vector(1), b: new Vector(2) }));
say("map", asMap.get("a").add(asMap.get("b")));
asMap.get("a").x = "text";
say("map stored", asMap.get("a").x);
let count = 0;
for (let turn = 0; turn < 300; turn++) count += sum({ a: new Vector(turn), b: new Vector(1) });
say("turns", count);
const later = { a: new Vector(1) };
const laterPairs = Object.entries(later);
later.a = new Vector(50);
say("later", laterPairs[0][1].x, later.a.x);
Object.freeze(laterPairs[0]);
try { "use strict"; laterPairs[0][1] = 1; } catch (error) { say("frozen", error.constructor.name); }
say("kept", laterPairs[0][1].x);
console.log(lines.join("\n"));
