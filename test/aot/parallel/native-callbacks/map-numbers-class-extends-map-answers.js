// The get method of a class that extends Map answers larger numbers than the Map holds; a loop reads it beside a plain Map.
const log = [];
class Scaled extends Map { get(key) { const found = super.get(key); return found === undefined ? found : found * 4294967296; } }
const scaled = new Scaled(Object.entries({ a: 1, b: 3 })); scaled.set("c", 5);
const plain = new Map(Object.entries({ a: 1 }));
for (const map of [scaled, plain]) log.push(map.get("a") + 1, typeof map.get("z"));
log.push(scaled.get("c") + 1, Map.prototype.get.call(scaled, "b") + 1);
console.log(log.join("; "));
