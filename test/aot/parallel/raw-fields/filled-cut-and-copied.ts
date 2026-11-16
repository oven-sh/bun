// Fields of any number: filled from lists with holes and NaN, cut to int32s, copied by spreads whose keys come in other orders.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v)) + " "; log += "\n"; }
interface Node { value: number; next: Node | null }
interface Pair { low: number; high: number }
interface State { id: number; count: number; total: number; name: string; done: boolean }
interface Loose { a?: number; b?: number; c?: string }
function chain(list: number[]): Node | null { let head: Node | null = null; for (const n of list) head = { value: n, next: head }; return head; }
function cut(head: Node | null): number { let t = 0; for (let node = head; node !== null; node = node.next) t = (t * 3 + (node.value & 255) + (node.value >> 1) + (node.value >>> 28) + (node.value | 0) % 7 + (~node.value & 3) + (node.value << 2) % 11) | 0; return t; }
function cutOnce(head: Node | null): number { let t = 0; for (let node = head; node !== null; node = node.next) t += node.value & 255; return t; }
function sum(head: Node | null): number { let t = 0; for (let node = head; node !== null; node = node.next) t += node.value; return t; }
function less(head: Node | null): number { let t = 0; for (let node = head; node !== null; node = node.next) if (node.value < 100) t++; return t; }
function bounds(values: number[], from: number): Pair { let low = values[from], high = values[from]; for (let i = from + 1; i < from + 4 && i < values.length; i++) { if (values[i] < low) low = values[i]; if (values[i] > high) high = values[i]; } return { low, high }; }
function allBounds(values: number[]): string { let t = 0, text = ""; for (let k = 0; k < values.length; k++) { const { low, high } = bounds(values, k); t += high - low; const kept = bounds(values, k); text += kept.low + "/" + kept.high + " "; } return t + " " + text; }
function reduce(state: State, n: number): State { return { ...state, count: state.count + 1, total: (state.total + n) & 0xffffff }; }
function run(list: number[], id: number): State { let state: State = { id, count: 0, total: 0, name: "initial", done: false }; for (const n of list) state = reduce(state, n); return state; }
function runOther(list: number[], id: number): State { let state: State = { done: true, name: "other", total: 5, count: 0.5, id }; for (const n of list) state = { ...state, total: state.total + n, done: n > 3 }; return state; }
function runMixed(list: number[]): string { let t = ""; let a: State = { id: 1, count: 0, total: 0, name: "a", done: false }, b: State = { name: "b", id: 2, done: true, total: 0, count: 9 }; for (const n of list) { const held = a; a = { ...b, count: b.count + n }; b = { ...held, name: held.name + n }; t += Object.keys(a).join() + " "; } return t + JSON.stringify([a, b]); }
function runLoose(list: number[]): string { let t = ""; let state: Loose = {}; for (const n of list) { state = n & 1 ? { ...state, a: n } : { ...state, b: n, c: "c" + n }; t += JSON.stringify(state); } return t; }
function runDeleted(list: number[]): string { let state: any = { id: 1, count: 0, total: 0, name: "x", done: false }; let t = ""; for (const n of list) { state = { ...state, count: state.count + 1, total: n }; if (n === 3) delete state.name; if (n === 4) state.extra = n; t += Object.keys(state).length; } return t + JSON.stringify(state); }
function runFrozen(list: number[]): string { let state: State = Object.freeze({ id: 1, count: 0, total: 0, name: "f", done: false }); for (const n of list) state = { ...state, total: state.total + n }; try { (state as any).id = 7; } catch {} return JSON.stringify(state) + Object.isFrozen(state); }
function runGetter(list: number[]): string { let reads = 0; const first: any = { id: 1, get count() { reads++; return 3; }, total: 0, name: "g", done: false }; let state: State = first; for (const n of list) state = { ...state, total: state.total + n }; return JSON.stringify(state) + reads; }
const lists: number[][] = [[], [1, 2, 3, 4, 5], [0.5, -0, NaN, 1e10, -1e10, 4294967295], [1, 2, undefined as any, null as any, "7" as any, 8], [3, , 4] as any, [1.5, , NaN, 2.5] as any, [2147483647, -2147483648, 1e300, -1e300, Infinity, -Infinity], Array.from({ length: 30 }, (_, i) => i * 37 % 101)];
for (let round = 0; round < 4; round++) {
  for (const list of lists) {
    const head = chain(list); show(cut(head), cutOnce(head), sum(head), less(head)); if (head) { head.value = undefined as any; show(cut(head), cutOnce(head), sum(head), less(head)); head.value = null as any; show(cut(head), cutOnce(head), less(head)); head.value = "12" as any; show(cut(head), cutOnce(head), sum(head)); }
    show(allBounds(list)); show(run(list, round), runOther(list, round + 0.5)); show(runMixed(list)); show(runLoose(list)); show(runDeleted(list)); show(runFrozen(list), runGetter(list));
  }
}
console.log(log.length, log);
