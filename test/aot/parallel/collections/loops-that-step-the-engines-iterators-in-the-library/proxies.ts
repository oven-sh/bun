// Nothing is known of what the loops iterate over: it is read out of an object that unseen code has.
const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
function all(name: string) { const seen: unknown[] = []; for (const value of box[name]) { seen.push(value); if (seen.length > 9) break; } return seen; }
const log: string[] = []; const spy = (target: object, name: string) => new Proxy(target, { get(inner, key, receiver) { log.push(name + "." + String(key)); return Reflect.get(inner, key, receiver); } });
box.map = spy(new Map([[1, 2]]), "map"); attempt("a Proxy of a Map:", () => all("map")); say(log); log.length = 0;
box.set = new Proxy(new Set([1]), {}); attempt("a Proxy of a Set:", () => all("set"));
box.list = spy([1, 2], "list"); attempt("a Proxy of a list:", () => all("list")); say(log); log.length = 0;
box.iterator = spy(new Set([1, 2]).values(), "iterator"); attempt("a Proxy of a Set iterator:", () => all("iterator")); say(log); log.length = 0;
box.generator = spy((function* () { yield 1; })(), "generator"); attempt("a Proxy of a generator:", () => all("generator")); say(log); log.length = 0;
const inner = new Set([1, 2]).values(); box.forwards = new Proxy(inner, { get(target, key) { const found = Reflect.get(target, key, target); return typeof found === "function" ? found.bind(target) : found; } }); attempt("a Proxy that binds:", () => all("forwards"));
box.holds = new Map<unknown, unknown>([[spy({}, "key"), spy({}, "value")]]); say(all("holds").length, log);
const revocable = Proxy.revocable([1, 2, 3], {}); box.revoked = revocable.proxy; attempt("revoked in the loop:", () => { const seen: unknown[] = []; for (const value of box.revoked) { seen.push(value); revocable.revoke(); } return seen; });
