const { fullGC } = require("bun:jsc");
globalThis.collect = () => void fullGC();
const text = n => `
const lines = [], own = Object.prototype.hasOwnProperty;
const list = o => [Object.keys(o).join("|"), Object.getOwnPropertyNames(o).join("|"), Reflect.ownKeys(o).map(String).join("|"), Object.entries(o).length, own.call(o, "late${n}")].join(" ");
// Each object has names that no other object has.
const made = [];
for (let k = 0; k < 40; k++) {
    const o = {};
    for (let j = 0; j <= k % 9; j++) o["name${n}_" + k + "_" + j] = j;
    made.push(o);
    lines.push(list(o));
    if (k % 3 === 0) o["late${n}"] = k;
    if (k % 4 === 0) delete o["name${n}_" + k + "_0"];
    if (k % 5 === 0) o["name${n}_" + k + "_0"] = "again";
    if (k % 6 === 0) Object.defineProperty(o, "hidden${n}", { value: 1, enumerable: false, configurable: true });
    if (k % 7 === 0) Object.freeze(o);
    try { if (k % 8 === 0) Object.setPrototypeOf(o, { inherited: 1 }); } catch (e) { lines.push(e.name); }
    if (k % 10 === 0) o[k] = "index";
    if (k % 11 === 0) o[Symbol.for("s")] = 1;
    if (k === 20) collect();
    lines.push(list(o), list(o), JSON.stringify(o));
}
// A list that was given is the caller's.
const shared = { ["only${n}"]: 1, ["two${n}"]: 2 };
const first = Object.keys(shared), second = Object.keys(shared);
first.push("mine"); first[0] = "changed";
lines.push(first.join(), second.join(), Object.keys(shared).join());
// Objects of one shape that are listed between their additions.
for (let k = 0; k < 6; k++) { const o = {}; o["a${n}"] = 1; lines.push(Object.keys(o).join()); o["b${n}"] = 2; lines.push(Object.keys(o).join()); o["c${n}"] = 3; lines.push(Object.keys(o).join(), o["b${n}"]); for (const key in o) lines.push(key); }
for (const o of made) lines.push(list(o));
// Proxies answer anew each time.
let count = 0;
const target = { a: 1, get b() { return this === proxy ? "proxy" : "target"; } };
const handler = {};
const proxy = new Proxy(target, handler);
const read = o => [o.a, o.b, o.missing, o.constructor === Object].join();
for (let k = 0; k < 30; k++) {
    if (k === 10) handler.get = (t, key, self) => { count++; return key === "a" ? "trapped" : Reflect.get(t, key, self); };
    if (k === 20) delete handler.get;
    if (k === 25) Object.setPrototypeOf(target, null);
    lines.push(read(proxy), read(target), read(new Proxy(proxy, {})));
}
const revocable = Proxy.revocable({ a: 1 }, {});
for (let k = 0; k < 4; k++) { if (k === 2) revocable.revoke(); try { lines.push(read(revocable.proxy)); } catch (e) { lines.push(e.name); } }
lines.push(count);
lines.join("\\n");
`;
for (let t = 0; t < 3; t++) console.log((0, eval)("{" + text(t % 2) + "}"));
