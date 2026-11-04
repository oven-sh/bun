const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error)); } };
const log: string[] = []; const told = () => { const all = log.join(); log.length = 0; return all; };
function copy(items: any) { return Array.from(items); }
function copyOf(name: string) { return Array.from(box[name]); }
// What a Map holds is handed out as it is: no getter, no conversion, no method of a key or a value runs, so nothing changes the Map while it is copied.
const map = new Map<unknown, unknown>();
const nosy = (name: string) => ({ get 0() { log.push(name + "[0]"); map.clear(); return 0; }, get length() { log.push(name + ".length"); map.clear(); return 0; }, toString() { log.push(name + ".toString"); map.clear(); return name; }, valueOf() { log.push(name + ".valueOf"); map.clear(); return 0; }, [Symbol.toPrimitive]() { log.push(name + " to a primitive"); map.clear(); return 0; }, [Symbol.iterator]() { log.push(name + " is iterated"); map.clear(); return [].values(); }, toJSON() { log.push(name + ".toJSON"); return name; }, then() { log.push(name + ".then"); } });
for (let turn = 0; turn < 3; turn++) {
  map.clear(); const key = nosy("key"), value = nosy("value"); map.set(key, value); map.set(new Proxy({}, { get(_, name) { log.push("a Proxy is read: " + String(name)); return undefined; } }), 1); map.set(2, new Proxy(function () {}, { apply() { log.push("a Proxy is called"); } }));
  const pairs = copy(map) as unknown[][], again = copy(map.entries()) as unknown[][];
  say(pairs.length, again.length, map.size, pairs[0][0] === key, pairs[0][1] === value, again[0][0] === key, again[0] !== pairs[0], "[" + told() + "]");
  box.map = map; say(copyOf("map").length, "[" + told() + "]");
}
