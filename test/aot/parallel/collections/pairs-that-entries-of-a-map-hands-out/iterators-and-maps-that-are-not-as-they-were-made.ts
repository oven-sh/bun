const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
const make = () => new Map<string, number>([["a", 1], ["b", 2]]);
let held: any = make().entries(); held.next = function () { return { done: true }; }; say([...held]);
held = make().entries(); let calls = 0; const real = held.next; held.next = function () { calls++; return real.call(this); }; say([...held], calls);
held = make().entries(); held[Symbol.iterator] = function () { return ["its own iterator"].values(); }; say([...held]);
held = make().entries(); held.return = function () { say("never called"); return {}; }; say([...held]);
held = make().entries(); held.other = 1; say([...held], held.other);
held = make().entries(); Object.setPrototypeOf(held, { [Symbol.iterator]() { return [1].values(); } }); say([...held]);
held = make().entries(); Object.setPrototypeOf(held, null); attempt("no prototype:", () => [...held]);
held = make().entries(); held.next = 5; attempt("next is no function:", () => [...held]);
held = make().entries(); held.next = () => 5; attempt("next gives no object:", () => [...held]);
held = Object.freeze(make().entries()); say([...held], held.next());
held = new Proxy(make().entries(), {}); attempt("a Proxy of the iterator:", () => [...held]);
class Own extends Map<string, number> { entries(): any { return [["of the class", 0]].values(); } }
class Plain extends Map<string, number> {}
class Walks extends Map<string, number> { *[Symbol.iterator](): any { yield ["generated", 0]; } }
say([...new Own([["a", 1]]).entries()], [...new Plain([["a", 1]]).entries()], [...new Walks([["a", 1]]).entries()], [...new Walks([["a", 1]])], [...Map.prototype.entries.call(new Own([["a", 1]]))]);
const named: any = make(); named.entries = () => [["on the instance", 0]].values(); say([...named.entries()], [...Map.prototype.entries.call(named)]);
attempt("entries of a Set by the method of Maps:", () => [...Map.prototype.entries.call(new Set([1]) as any)]);
say([...new Set(["x", "y"]).entries()], [...["x"].entries()], [...new URLSearchParams("q=1").entries()]);
