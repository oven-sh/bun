const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error)); } };
const log: string[] = []; const told = () => { const all = log.join(); log.length = 0; return all; };
function copy(items: any) { return Array.from(items); }
function copyOf(name: string) { return Array.from(box[name]); }
// The iterator is made over the table of that moment, and hands out what the Map holds when it is stepped.
const make = (size = 3) => new Map<number, string>(Array.from({ length: size }, (_, index) => [index, "v" + index]));
for (let turn = 0; turn < 3; turn++) {
  let map = make(); let held = map.entries(); map.set(9, "added"); say(copy(held), copy(map));
  map = make(); held = map.entries(); map.delete(0); say(copy(held), copy(map));
  map = make(); held = map.entries(); map.delete(1); map.set(1, "moved to the end"); say(copy(held), copy(map));
  map = make(); held = map.entries(); map.clear(); say(copy(held), held.next(), copy(map));
  map = make(); held = map.entries(); map.clear(); map.set(7, "behind a clear"); say(copy(held), copy(map));
  map = make(); held = map.entries(); map.clear(); map.clear(); for (let i = 0; i < 40; i++) map.set(i, "g"); map.clear(); map.set(1, "thrice cleared"); say(copy(held));
  map = make(); held = map.entries(); for (let i = 10; i < 400; i++) map.set(i, "grown"); say(copy(held).length, copy(map).length, map.size);
  map = make(400); held = map.entries(); for (let i = 0; i < 399; i++) map.delete(i); say(copy(held), copy(map));
  map = make(400); held = map.entries(); for (let i = 0; i < 400; i += 2) map.delete(i); for (let i = 1000; i < 1300; i++) map.set(i, "x"); say(copy(held).length, copy(map).length, map.size);
  map = make(); const first = map.entries(), second = map.entries(); first.next(); map.delete(0); map.delete(1); say(copy(second), copy(first));
  map = make(5); const seen: unknown[] = []; for (const [key] of map) { seen.push(key, copy(map).length, copy(map.entries()).length); map.delete(key + 1); } say(seen);
}
