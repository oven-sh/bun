const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error)); } };
const log: string[] = []; const told = () => { const all = log.join(); log.length = 0; return all; };
function copy(items: any) { return Array.from(items); }
function copyOf(name: string) { return Array.from(box[name]); }
// Whoever holds the iterator finds it where the steps of Array.from would have left it. Every call stands in a function that is called many times.
const make = () => new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
for (let turn = 0; turn < 3; turn++) {
  let map = make(); let held = map.entries(); say(copy(held), held.next(), copy(held)); map.set("d", 4); say(held.next(), copy(held));
  map = make(); held = map.entries(); say(held.next()); say(copy(held), held.next());
  map = make(); held = map.entries(); held.next(); held.next(); held.next(); say(copy(held)); say(held.next());
  map = make(); held = map.entries(); held.next(); held.next(); held.next(); held.next(); map.set("late", 9); say(copy(held));
  map = new Map(); held = map.entries(); say(copy(held)); map.set("late", 9); say(copy(held), held.next());
  map = new Map(); held = map.entries(); map.set("in time", 1); say(copy(held), held.next());
  box.map = make(); box.held = box.map.entries(); say(copyOf("held"), box.held.next(), copyOf("map"), copyOf("map")); box.again = box.map.entries(); box.again.next(); say(copyOf("again"));
  say(copy(make()), copy(make().entries()), copy(make()[Symbol.iterator]()), copy(make().keys()), copy(make().values()), new Map(copy(make()) as any).size);
  const byLoop = make().entries(); for (const pair of byLoop) { say(pair, copy(byLoop)); }
}
