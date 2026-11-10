function make(v: any) { return { current: v }; }
function either(flag: boolean) { return flag ? { a: 1 } : { b: "x", a: 2 }; }
class Box { v: number; constructor(v: number) { this.v = v; } get twice() { return this.v * 2; } }
class Heir extends Box { get twice() { return -this.v; } }
function boxed(flag: boolean) { return flag ? new Box(3) : new Heir(4); }
function readEarly() { return typeof cursor + ":" + typeof list + ":" + typeof table + ":" + typeof box; }
const out: unknown[] = [];
out.push(readEarly());
var cursor: any = make(null), list: any = [1, 2.5, "x"], table: any = { bias: 0.5, other: 2 }, one: any = either(true), other: any = either(false), box: any = new Box(5), maybe: any = boxed(false), empty: any = {}, none: any = [];
(globalThis as any).kept = [{ current: 1 }, { tag: 3, current: 2 }, { current: 3, next: null }, cursor, table, list, one, other, box, maybe, empty, none];
function use(n: number) { let s = 0; for (let i = 0; i < n; i++) { cursor.current = i; s += cursor.current + table.bias + list.length + one.a + other.a + box.twice + maybe.twice + none.length + (empty.late ? 1 : 0); } return s; }
function outer(k: number) {
    var held: any = make(k), stack: any = [], rules: any = { step: k, name: "r" }, depth = 0;
    function push(v: any) { depth++; stack[depth] = held.current; held.current = v; }
    function pop() { held.current = stack[depth]; stack[depth] = null; depth--; }
    return function run(n: number) { let s = 0; for (let i = 0; i < n; i++) { push(i); s += held.current * rules.step; pop(); } return s + ":" + held.current + ":" + depth + ":" + rules.name; };
}
out.push(readEarly(), use(10), outer(2)(5), outer(0.5)(4));
delete table.bias; table.late = 1; out.push(use(3)); table.bias = "text"; out.push(use(2));
Object.defineProperty(cursor, "current", { get() { return 100; }, set(v) { }, configurable: true }); out.push(use(3));
Object.setPrototypeOf(box, Heir.prototype); out.push(use(2)); list.length = 0; list.extra = 1; out.push(use(2)); empty.late = true; none.push(1, 2); out.push(use(2));
Object.setPrototypeOf(one, null); Object.freeze(other); out.push(use(2));
console.log(out.map(String).join("\n"));
export {};
