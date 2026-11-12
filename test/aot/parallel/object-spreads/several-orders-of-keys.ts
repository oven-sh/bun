// Spreads into object literals from sources whose keys come in several orders; in front, in the middle and behind; optional, added and left out keys; instances, accessors, frozen and deleted.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v)) + " "; log += "\n"; }
interface State { id: number; count: number; total: number; name: string; done: boolean }
interface Part { total: number; name: string; done: boolean }
interface Loose { id: number; a?: number; b?: number; c?: string }
class Point { constructor(public x: number, public y: number) {} length(): number { return this.x + this.y; } get sum(): number { return this.x * 2; } }
class Place { y = 0; x = 0; #hidden = 5; constructor(y: number, x: number) { this.y = y; this.x = x; } seen(): number { return this.#hidden; } }
const first = (): State => ({ id: 1, count: 0, total: 0, name: "a", done: false });
const second = (): State => ({ name: "b", done: true, total: 5, count: 2, id: 2 });
const third = (): State => ({ total: 1, id: 3, done: false, name: "c", count: 4 });
const part = (): Part => ({ total: 0, name: "p", done: false }), part2 = (): Part => ({ name: "q", done: true, total: 5 });
function reduce(state: State, n: number): State { return { ...state, count: state.count + 1, total: (state.total + n) & 1023 }; }
function run(state: State, list: number[]): State { for (const n of list) state = reduce(state, n); return state; }
function runInline(state: State, list: number[]): State { let x = state; for (const n of list) x = { ...x, count: x.count + 1, total: (x.total + n) & 1023 }; return x; }
function mixed(list: number[]): string { let t = ""; const sources = [first(), second(), third()]; for (const n of list) { const i = Math.abs(n | 0) % 3; const x = { ...sources[i], count: n }; sources[i] = reduce(x, n); t += Object.keys(sources[i]).join() + sources[i].count + " "; } return t + JSON.stringify(sources); }
function middle(list: number[], p: Part, q: Part): string { let t = ""; for (const n of list) { const x: State = { id: n, ...(n & 1 ? p : q), count: n * 2 }; t += JSON.stringify(x); } return t; }
function last(list: number[], p: Part, q: Part): string { let t = ""; for (const n of list) { const x: State = { id: n, count: 3, ...(n & 1 ? p : q) }; t += JSON.stringify(x); } return t; }
function both(list: number[], s: State, change: { count: number; done: boolean }): string { let t = ""; for (const n of list) { const x = { ...s, ...change, total: n }; t += JSON.stringify(x); } return t; }
function bothFront(list: number[], p: any, change: any): string { let t = ""; for (const n of list) { const x = { front: n, ...p, between: 1, ...change, last: n }; t += JSON.stringify(x); } return t; }
function front(list: number[], s: any): string { let t = ""; for (const n of list) { const x = { total: n, id: -1, ...s }; t += JSON.stringify(x) + x.total; } return t; }
function make(id: number, p: Part): State { return { id, ...p, count: id & 7 }; }
function loose(list: number[], sources: Loose[]): string { let t = ""; for (const n of list) { const x: Loose = { ...sources[Math.abs(n | 0) % sources.length], a: n }; t += JSON.stringify(x); } return t; }
function conditional(list: number[]): string { let t = ""; for (const n of list) { const x: Loose = { id: n, ...(n & 1 ? { a: n } : {}), ...(n & 2 && { b: n }), ...(n > 3 ? { c: "c" } : null) }; t += JSON.stringify(x); } return t; }
function rest(list: number[], s: State, o: State): string { let t = ""; for (const n of list) { const { name, ...others } = n & 1 ? s : o; t += name + JSON.stringify(others); } return t; }
function assigned(list: number[], s: State, o: State): string { let t = ""; for (const n of list) { const x = Object.assign({}, n & 1 ? s : o, { total: n }); t += JSON.stringify(x); } return t; }
function instances(list: number[], a: any, b: any): string { let t = ""; for (const n of list) { const x = { ...(n & 1 ? a : b), y: n }; t += JSON.stringify(x) + typeof x.length + x.sum + (x instanceof Point); } return t; }
function computed(list: number[]): string { let x: any = { a: 1, b: 2, c: 3 }, t = ""; for (const n of list) { x = { ...x, [n & 1 ? "a" : "d" + (n & 2)]: n }; t += Object.keys(x).join(); } return t + JSON.stringify(x); }
function odd(source: any, list: number[]): string { let t = ""; for (const n of list) { const x: State = { ...source, count: n }; t += JSON.stringify(x) + Object.keys(x).length; } return t; }
function changing(list: number[]): string { let x: any = first(), t = ""; for (const n of list) { x = { ...x, count: n }; if (n === 2) delete x.name; if (n === 3) x.extra = 1; if (n === 4) Object.freeze(x); if (n === 5) x = second(); t += JSON.stringify(x) + Object.isFrozen(x); } return t; }
const symbol = Symbol("s");
const lists: number[][] = [[], [1], [1, 2, 3, 4, 5, 6, 7], [0.5, -0, NaN, 3], Array.from({ length: 20 }, (_, i) => i)];
for (let round = 0; round < 4; round++) {
  for (const list of lists) {
    show(run(first(), list), run(second(), list), run(third(), list), runInline(second(), list), runInline(first(), list), runInline(third(), list)); show(mixed(list)); show(middle(list, part(), part2())); show(middle(list, part2(), part())); show(last(list, part(), part2()));
    show(both(list, first(), { count: 9, done: true }), both(list, second(), { done: false, count: 8 } as any)); show(bothFront(list, part(), { total: 4, more: 1 }), bothFront(list, { last: 1, between: 2 }, { front: 0 })); show(front(list, first()), front(list, part2()), front(list, {}), front(list, null), front(list, "ab"));
    show(list.map(n => make(n, n & 1 ? part() : part2()))); show(loose(list, [{ id: 1 }, { id: 2, a: 3 }, { c: "x", id: 4, b: 5 }])); show(conditional(list)); show(rest(list, first(), second())); show(assigned(list, first(), third()));
    show(instances(list, new Point(1, 2), new Place(3, 4)), instances(list, new Point(1, 2), { x: 5, y: 6 })); show(computed(list)); show(changing(list));
    show(list.reduce(reduce, second()), list.map(n => ({ ...(n & 1 ? first() : second()), count: n })), list.map(n => ({ n, ...third() })));
  }
  let reads = 0; const sources: any[] = [Object.freeze(second()), { ...first(), get name() { reads++; return "g" + reads; } }, Object.create(first()), Object.assign(Object.create({ above: 1 }), third()), { ...first(), [symbol]: 1, 7: "seven", 1: "one" }, [1, 2], "text", null, undefined, 5, new Proxy(first(), {}), Object.defineProperty(first(), "name", { enumerable: false }), Object.assign(first(), { count: undefined }), new Map([[1, 2]]), () => 1, Object.create(null, { id: { value: 1, enumerable: true } })];
  for (const source of sources) show(odd(source, [1, 2, 3])); show(reads);
  const bad: any = { ...first(), get total() { throw new Error("read"); } }; try { show(odd({ get id() { return 1; }, get name(): string { throw new Error("read " + round); } }, [1])); } catch (error: any) { show(error.message, typeof bad); }
}
console.log(log.length, log);
