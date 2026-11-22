const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
// Whoever holds the iterator finds it where the steps of the spread would have left it.
const make = () => new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
let map = make(); let held = map.entries(); say([...held], held.next(), [...held]); map.set("d", 4); say(held.next(), [...held]);
map = make(); held = map.entries(); say(held.next()); say([...held], held.next());
map = make(); held = map.entries(); held.next(); held.next(); held.next(); say([...held]); say(held.next());
map = make(); held = map.entries(); held.next(); held.next(); held.next(); held.next(); map.set("late", 9); say([...held]);
map = new Map(); held = map.entries(); say([...held]); map.set("late", 9); say([...held], held.next());
map = new Map(); held = map.entries(); map.set("in time", 1); say([...held], held.next());
box.map = make(); box.held = box.map.entries(); say([...box.held], box.held.next()); box.again = box.map.entries(); box.again.next(); say([...box.again]);
function count(...pairs: unknown[]) { return pairs.length; } map = make(); held = map.entries(); say(count(...held), count(...held), count(0, ...map.entries(), ...map.entries()));
say([0, ...make().entries(), 9], [...make().entries(), ...make().entries()].length, new Map([...make().entries()]).size, Math.max(...[...make().entries()].map(([, value]) => value)));
say([...make().keys()], [...make().values()], [...make()], [...make()[Symbol.iterator]()]);
const twice = make().entries(); say([...twice, ...twice]);
