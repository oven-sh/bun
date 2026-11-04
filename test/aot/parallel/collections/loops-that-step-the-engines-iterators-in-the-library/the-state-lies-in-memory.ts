// Nothing is known of what the loops iterate over: it is read out of an object that unseen code has.
const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
// Loops whose steps stand under a handler, that are left in every way, and that are suspended between their steps.
box.map = new Map([["a", 1], ["b", 2], ["c", 3]]); box.set = new Set([1, 2, 3]); box.own = { from: 1, [Symbol.iterator]() { let at = this.from; return { next: () => at > 3 ? { done: true, value: undefined } : { done: false, value: at++ }, return() { say("own return"); return {}; } }; } };
for (const name of ["map", "set", "own"]) {
  attempt(name + " under try:", () => { const seen: unknown[] = []; try { for (const value of box[name]) { seen.push(value); if (seen.length === 2) throw new Error("second"); } } catch (error) { seen.push(String(error)); } finally { seen.push("finally"); } return seen; });
  attempt(name + " returns:", () => { for (const value of box[name]) { try { return value; } finally { say("left"); } } });
  attempt(name + " continues:", () => { const seen: unknown[] = []; outer: for (const a of box[name]) { for (const b of box[name]) { if (seen.length > 5) break outer; if (a === b) continue outer; seen.push([a, b]); } } return seen.length; });
  attempt(name + " in a closure:", () => { const made: (() => unknown)[] = []; for (const value of box[name]) made.push(() => value); return made.map(one => one()); });
}
function* suspended(name: string): Generator<unknown, void, unknown> { for (const value of box[name]) { const sent = yield value; if (sent) say("sent", sent); } }
for (const name of ["map", "set", "own"]) { const it = suspended(name); say(it.next().value, it.next("x").value); box.set.add(4); box.map.set("d", 4); say([...it]); box.set.delete(4); box.map.delete("d"); }
const early = suspended("own"); early.next(); say(early.return(undefined as never));
async function awaits(name: string) { const seen: unknown[] = []; for (const value of box[name]) { await null; seen.push(value); try { await Promise.reject(new Error("no")); } catch {} } return seen; }
say(await awaits("map"), await awaits("set"), await awaits("own"));
say((await Promise.all([awaits("set"), awaits("set"), awaits("map")])).length);
const [first, , third = "none", ...rest] = box.set; say(first, third, rest);
const [[key, value], second] = box.map; say(key, value, second);
let a: unknown, b: unknown; [a, b = (say("default"), 9)] = box.set.values(); say(a, b); [a, b = (say("default"), 9)] = new Set([1]).values() as any; say(a, b);
function takes([one, two]: any, ...others: unknown[]) { return [one, two, others.length]; } say(takes(box.map.keys(), 1), takes(box.own));
