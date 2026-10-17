// Literals of the same members in two files are frozen, extended, redefined and given prototypes one by one.
declare const console: { log(...values: unknown[]): void };
import { first, turned, make, nested, holdsFunction } from "./other";
const here = { a: 10, b: "h" };
const hereTurned = { b: "t", a: 11 };
const hereFunction = { a: 12, run: () => "main" };
const withProto = { __proto__: { inherited: 1 }, a: 13, b: "p" };
const numeric = { 1: "one", a: 14, b: "k" };
const asConst = { a: 1, b: "x" } as const;
const wider = { a: 15, b: "w", c: true };
function sum(list: { a: number; b: string }[]) { let n = 0, s = ""; for (const it of list) { n += it.a; s += it.b } return n + " " + s }
console.log(sum([first, turned, make(7), nested.p, nested.q[0], here, hereTurned, withProto, numeric, asConst, wider]));
console.log([first, turned, here, hereTurned, make(1), withProto, numeric].map(o => Object.keys(o).join()).join(" "));
console.log(JSON.stringify([first, turned, here, hereTurned, nested, numeric, asConst]));
console.log(holdsFunction.run(), hereFunction.run(), (withProto as any).inherited, Object.getPrototypeOf(here) === Object.prototype, Object.getPrototypeOf(withProto) === Object.prototype);
Object.freeze(first);
console.log(Object.isFrozen(first), Object.isFrozen(here), Object.isFrozen(make(2)));
here.a = 20; try { "use strict"; (first as { a: number }).a = 21 } catch (e) { console.log("frozen: " + (e as Error).constructor.name) }
console.log(first.a, here.a, (first as unknown) === here);
(here as any).more = 1; delete (make as any).nothing; const m = make(3); delete (m as any).b;
console.log(Object.keys(here).join(), Object.keys(m).join(), Object.keys(make(4)).join(), "b" in m, m.b);
Object.setPrototypeOf(hereTurned, { up: 1 });
console.log((hereTurned as any).up, (turned as any).up, (make(5) as any).up);
Object.defineProperty(turned, "a", { get() { return 99 }, configurable: true });
console.log(turned.a, hereTurned.a, sum([turned, hereTurned]));
const seen = new Map<object, string>([[first, "first"], [here, "here"]]);
console.log(seen.get(first), seen.get(here), seen.get(make(1)), seen.size);
