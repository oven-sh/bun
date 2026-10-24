// Each function here is called by name with one callback, so that one is all the compiler sees reach its parameter, its variable or its result. Then another callback gets there by a way that is hard to see. Both must be called as in plain Bun.
// @ts-ignore
import { sloppy } from "./sloppy.cjs";
type Callback = (x: number) => string;
const log: string[] = [];
const seen: Callback = x => "seen" + x;
const other: Callback = x => "other" + x;
const hide = <T,>(value: T): T => (JSON.parse("[0]") as number[]).map(() => value)[0]!;
function row(name: string, run: () => unknown) {
  try { log.push(name + ": " + String(run())); } catch (e) { log.push(name + "! " + (e as Error).constructor.name); }
}

function byCall(cb: Callback) { return cb(1); }
row("call", () => byCall(seen) + byCall.call(null, other));
function byApply(cb: Callback) { return cb(2); }
row("apply", () => byApply(seen) + byApply.apply(null, [other]));
function byReflect(cb: Callback) { return cb(3); }
row("Reflect.apply", () => byReflect(seen) + Reflect.apply(byReflect, null, [other]));
function byBind(cb: Callback) { return cb(4); }
row("bind", () => byBind(seen) + byBind.bind(null, other)() + byBind.bind(null)(other));
function byNew(this: any, cb: Callback) { this.result = cb(5); }
row("new", () => { const direct: any = {}; byNew.call(direct, seen); return direct.result + new (byNew as any)(other).result; });
function byForEach(cb: Callback) { log.push("  forEach " + cb(6)); }
row("forEach", () => { byForEach(seen); [other].forEach(byForEach); [other].map(byForEach as any); });
function bySpread(cb: Callback) { return cb(7); }
row("spread", () => bySpread(seen) + bySpread(...([other] as [Callback])));
function byAny(cb: Callback) { return cb(8); }
row("any", () => byAny(seen) + (byAny as any)(other) + hide(byAny)(other));
function byCallCall(cb: Callback) { return cb(9); }
row("call.call", () => byCallCall(seen) + Function.prototype.call.call(byCallCall, null, other));
function byProperty(cb: Callback) { return cb(10); }
row("property", () => { const o: any = {}; Object.defineProperty(o, "f", { value: byProperty }); return byProperty(seen) + o.f(other) + o["f"](other); });
function byProxy(cb: Callback) { return cb(11); }
row("proxy", () => byProxy(seen) + new Proxy(byProxy, {})(other) + new Proxy({}, { get: () => byProxy } as any as ProxyHandler<any>).anything(other));
function byTag(strings: TemplateStringsArray, cb: Callback) { return strings.length + cb(12); }
row("tag", () => byTag`a${seen}b` + hide(byTag)`a${other}b`);
function bySort(a: Callback, b: Callback) { log.push("  sort " + a(13) + b(13)); return 0; }
row("sort", () => { bySort(seen, seen); [other, other].sort(bySort); });
function byThen(cb: Callback) { log.push("  then " + cb(14)); }
byThen(seen);
const later = Promise.resolve(other).then(byThen);
function byGetter(cb: Callback) { return cb(15); }
row("getter", () => { const o = { get f() { return byGetter; } }; return byGetter(seen) + o.f(other); });
function byIterator(cb?: Callback) { return { next: () => ({ done: true, value: cb ? cb(16) : "none" }) }; }
row("iterator", () => { byIterator(seen).next(); return [...({ [Symbol.iterator]: byIterator } as Iterable<unknown>)].length; });
function byDefault(first: Callback, second: Callback = first) { return second(17); }
row("default", () => byDefault(seen) + byDefault(seen, hide(other)) + byDefault(hide(other)));
function byRest(...all: Callback[]) { return all.map(cb => cb(18)).join(); }
row("rest", () => byRest(seen) + byRest(seen, hide(other)));

let variable: Callback = seen;
function setVariable(cb: Callback) { variable = cb; }
row("variable", () => { const before = variable(19); hide(setVariable)(other); return before + variable(19); });
function makeCounter() { let held: Callback = seen; return { set(cb: Callback) { held = cb; }, run() { return held(20); } }; }
row("environment", () => { const counter = makeCounter(); const before = counter.run(); (counter as any)["s" + "et"](other); return before + counter.run(); });
function returned(flag: boolean): Callback { try { if (flag) throw other; return seen; } catch (e) { return e as Callback; } }
row("thrown", () => returned(false)(21) + returned(true)(21));
function* generator(): Generator<number, string, Callback> { const cb = yield 1; return cb(22); }
row("generator", () => { const a = generator(); a.next(); const b = generator(); b.next(); return a.next(seen).value + "" + b.next(hide(other)).value; });
async function awaited(promise: Promise<Callback>) { return (await promise)(23); }
const awaitedBoth = Promise.all([awaited(Promise.resolve(seen)), awaited(Promise.resolve(hide(other)))]);
class Holder { static kept: Callback = seen; held: Callback = seen; run() { return this.held(24) + Holder.kept(24); } }
row("class", () => { const holder = new Holder(); const before = holder.run(); Object.assign(holder, { held: other }); (Holder as any).kept = other; return before + holder.run(); });
const list: Callback[] = [seen];
row("array", () => { const before = list[0]!(25); (list as any).unshift(other); return before + list[0]!(25) + list.at(-1)!(25); });
const map = new Map<string, Callback>([["k", seen]]);
row("map", () => { const before = map.get("k")!(26); hide(map).set("k", other); return before + map.get("k")!(26); });
function notAFunction(cb: Callback) { return cb(27); }
row("number", () => notAFunction(seen) + (notAFunction as any)(5));
row("nothing", () => notAFunction(seen) + (notAFunction as any)());
row("object", () => notAFunction(seen) + (notAFunction as any)({}));
row("sloppy", () => sloppy(seen, other));
await later;
log.push("awaited: " + (await awaitedBoth).join());
console.log(log.join("\n"));
