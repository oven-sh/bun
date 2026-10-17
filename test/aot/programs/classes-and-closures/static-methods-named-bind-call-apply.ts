// Classes with static methods named `bind`, `call` and `apply`: calls such as `C.call(..)` reach the class's own method.
declare const console: { log(...values: unknown[]): void };
function say(...parts: unknown[]): void { console.log(parts.map(p => typeof p === "string" ? p : JSON.stringify(p)).join(" ")); }
function show(r: unknown): unknown { return typeof r === "function" ? "function " + JSON.stringify((r as Function).name) + " -> " + JSON.stringify(attempt(() => { const v: any = (r as () => unknown)(); return v && typeof v.next === "function" ? "iterator" : v && typeof v.then === "function" ? "promise" : v; })) : r; }
function attempt(f: () => unknown): unknown { try { return show(f()); } catch (e) { return "throws " + (e as Error).constructor.name; } }
class AtOnce { static bind(...a: unknown[]) { return () => "static bind " + a.length; } static call(...a: unknown[]) { return "static call " + a.length; } static apply(...a: unknown[]) { return "static apply " + a.length; } }
say("at once:", attempt(() => AtOnce.bind(null, 1)), attempt(() => AtOnce.call(null, 1)), attempt(() => AtOnce.apply(null, [1])));
class First { static one = 1; }
class Second extends First { static two() { return 2; } }
class OnlyBind { static bind(...a: unknown[]) { return () => "only bind " + a.length; } }
class OnlyCall { static call(...a: unknown[]) { return "only call " + a.length; } }
class OnlyApply { static apply(...a: unknown[]) { return "only apply " + a.length; } }
class Inherits extends OnlyBind { }
class Plain { constructor(public v = 1) { } }
function declared(this: unknown, a?: number, b?: number) { return [typeof this, a, b]; }
function withOwnCall(a?: number) { return a; }
(withOwnCall as any).call = () => "own call";
(withOwnCall as any).bind = () => () => "own bind";
const arrow = (a?: number, b?: number) => [a, b];
const asyncArrow = async (a?: number) => a;
function* generator(a?: number) { yield a; }
say("behind other classes:", First.one, Second.two(), attempt(() => OnlyBind.bind(1, 2)), attempt(() => OnlyCall.call(1, 2)), attempt(() => OnlyApply.apply(1, [2])), attempt(() => Inherits.bind(1)));
say("in sight:", attempt(() => declared.bind(1, 2)(3)), attempt(() => declared.call(1, 2, 3)), attempt(() => declared.apply(1, [2, 3])), attempt(() => arrow.bind(null, 1)(2)), attempt(() => arrow.call(null, 1, 2)), attempt(() => arrow.apply(null, [1, 2])));
say("in sight, with its own:", attempt(() => withOwnCall.call(null, 1)), attempt(() => withOwnCall.bind(null, 1)), attempt(() => withOwnCall.apply(null, [1])));
say("in sight, a class:", attempt(() => (Plain as any).call(null)), attempt(() => (Plain as any).apply(null, [])), attempt(() => new (Plain.bind(null, 5))().v));
say("in sight, others:", attempt(() => typeof asyncArrow.bind(null, 1)()), attempt(() => typeof asyncArrow.call(null, 1)), attempt(() => [...generator.call(null, 4)]), attempt(() => [...generator.bind(null, 5)()]), attempt(() => [...generator.apply(null, [6])]));
const table: [string, any][] = [["AtOnce", AtOnce], ["OnlyBind", OnlyBind], ["OnlyCall", OnlyCall], ["OnlyApply", OnlyApply], ["Inherits", Inherits], ["Plain", Plain], ["declared", declared], ["withOwnCall", withOwnCall], ["arrow", arrow], ["asyncArrow", asyncArrow], ["generator", generator], ["a bound one", declared.bind(7)], ["an object", { bind: () => "object's bind", call: () => "object's call", apply: () => "object's apply" }], ["a host function", Math.max]];
for (let round = 0; round < 3; round++) {
  for (const [name, f] of table)
    say("through a table:", round, name, "|", attempt(() => f.bind(null, 1)), "|", attempt(() => { const r = f.call(null, 1, 2); return r && typeof r.next === "function" ? "iterator" : r && typeof r.then === "function" ? "promise" : r; }), "|", attempt(() => { const r = f.apply(null, [1, 2]); return r && typeof r.next === "function" ? "iterator" : r && typeof r.then === "function" ? "promise" : r; }));
}
let right = 0;
for (let i = 0; i < 3000; i++) {
  const c: any = i % 3 === 0 ? OnlyBind : i % 3 === 1 ? Plain : declared;
  const b = c.bind(null, i);
  if (i % 3 === 0 ? b() === "only bind 2" : i % 3 === 1 ? new b().v === i : b(0)[1] === i) right++;
}
say("in a loop:", right);
export {};
