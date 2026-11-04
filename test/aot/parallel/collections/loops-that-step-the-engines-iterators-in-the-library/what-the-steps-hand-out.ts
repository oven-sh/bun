// Nothing is known of what the loops iterate over: it is read out of an object that unseen code has.
const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
function all(name: string) { const seen: unknown[] = []; for (const value of box[name]) seen.push(value); return seen; }
const odd: unknown[] = ["s", 2, NaN, -0, null, undefined, 10n, Symbol.iterator, { o: 1 }, [1], true, 1.5, 2 ** 40, ""];
box.set = new Set(odd); for (const value of box.set) say(typeof value, value);
box.map = new Map(odd.map((value, index) => [value, odd[odd.length - 1 - index]])); for (const [key, value] of box.map) say(key, value);
box.values = box.map.values(); box.keys = box.map.keys(); say(all("values").length, all("keys").length);
box.entries = box.map.entries(); const pairs = all("entries") as unknown[][]; say(pairs.length, pairs[0] !== pairs[1], Array.isArray(pairs[0]), pairs[0].length); pairs[0][1] = "written"; say(box.map.get("s"));
box.ofSet = box.set.entries(); say((all("ofSet") as unknown[][]).every(([one, two]) => Object.is(one, two)));
box.list = odd.values(); say(all("list").length); box.holes = [, 1, , 2].values(); say(all("holes")); box.floats = [1.5, 2.5].values(); say(all("floats")); box.indexed = ["a", "b"].entries(); say(all("indexed"));
function args(..._: unknown[]) { return arguments; } box.arguments = (function () { return arguments; } as any)(1, "two", null); say(all("arguments"));
box.marks = new Set([new Set().values(), new Map().keys()]); say(all("marks").length);
for (const size of [0, 1, 7, 8, 9, 63, 64, 65, 1000]) { box.sized = new Set(Array.from({ length: size }, (_, index) => index % 3 ? index : "t" + index)); box.mapped = new Map(Array.from({ length: size }, (_, index) => [index, index * 2])); let count = 0; for (const _ of box.sized) count++; for (const [key, value] of box.mapped) count += value - key * 2 + 1; say(size, count); }
let total = 0; box.big = new Map(Array.from({ length: 2000 }, (_, index) => ["k" + index, index])); for (let turn = 0; turn < 200; turn++) { for (const [, value] of box.big) total += value; for (const value of box.big.values()) total += value; for (const key of box.big.keys()) total += key.length; } say(total);
