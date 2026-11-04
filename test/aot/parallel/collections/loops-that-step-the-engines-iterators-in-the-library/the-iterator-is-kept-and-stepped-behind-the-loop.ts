// Nothing is known of what the loops iterate over: it is read out of an object that unseen code has.
const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
box.map = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]); box.set = new Set([1, 2, 3, 4]); box.list = [1, 2, 3, 4];
for (const make of [() => box.map.values(), () => box.map.keys(), () => box.map.entries(), () => box.map[Symbol.iterator](), () => box.set.values(), () => box.set.entries(), () => box.list.values(), () => box.list.entries(), () => (function* () { yield* box.list; })()]) {
  box.kept = make(); const seen: unknown[] = [];
  for (const value of box.kept) { seen.push(value); if (seen.length === 2) break; }
  say(seen, box.kept.next(), [...box.kept], box.kept.next());
  box.begun = make(); box.begun.next(); const rest: unknown[] = []; for (const value of box.begun) rest.push(value); say(rest, box.begun.next());
  box.twice = make(); let first = 0, second = 0; for (const _ of box.twice) first++; for (const _ of box.twice) second++; say(first, second);
  box.shared = make(); const turns: unknown[] = []; for (const outer of box.shared) { turns.push(outer); for (const nested of box.shared) { turns.push(nested); break; } } say(turns);
}
box.done = box.set.values(); for (const _ of box.done); box.set.add(5); say(box.done.next(), [...box.done]);
