// Lists that stand before a loop of pushes and pops: parameters, variables of the module and of scopes; of every kind, aliased, with methods of their own, cut on the way.
const show = (x: any): string => typeof x === "function" ? "f" : Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + Array.from({ length: x.length }, (_, i) => i in x ? x[i] : "hole").map(show).join() + "]" : typeof x === "object" && x ? "{" + Object.keys(x).map(k => show(x[k])) + "}" : typeof x === "bigint" ? x + "n" : String(x);
let items: number[] = [];
const fixed: number[] = [];
const kept = { items: [] as number[], n: 0 };
let state = { items: [] as number[], n: 0 };
function filled(q: number[], L: number[]): any { for (let i = 0; i < L.length && i < 60; i++) q.push(L[i]!); return q; }
function drained(q: number[], L: number[]): any { let s = 0; while (q.length > 0) s += q.pop()!; return [s, q]; }
function both(q: number[], L: number[]): any { for (let i = 0; i < L.length && i < 60; i++) q.push(L[i]!); let s = 0; while (q.length > 1) s += q.pop()!; return [s, q]; }
function bounded(q: number[], L: number[]): any { let s = 0; for (let i = 0; i < L.length && i < 60; i++) { q.push(L[i]!); if (q.length > 3) s += q.pop()!; } return [s, q]; }
function monotonic(q: number[], L: number[]): any { let s = 0; for (let i = 0; i < L.length && i < 60; i++) { if (q.length > 0 && q[q.length - 1]! > L[i]!) s += q.pop()!; else q.push(L[i]!); } return [s, q]; }
function measured(q: number[], L: number[]): any { let s = 0; for (let i = 0; i < 8; i++) { q.push(i); s += L.length + q.length; } return [s, q, L]; }
function rewritten(q: number[], L: number[]): any { for (let i = 0; i < L.length && i < 20; i++) { q.push(L[i]!); L[i] = i / 2; } return [q, L]; }
function cut(q: number[], L: number[]): any { let s = 0; for (let i = 0; i < L.length && i < 20; i++) { q.push(L[i]!); if (i === 2) q.length = 1; } return [s, q]; }
function past(q: number[], L: number[]): any { let s = 0; for (let i = 0; i < 4; i++) s += q.pop()!; return [s, q]; }
function answers(q: number[], L: number[]): any { let n = 0; for (let i = 0; i < L.length && i < 20; i++) n += q.push(L[i]!); return [n, q]; }
function variable(q: number[], L: number[]): any { items = q; for (let i = 0; i < L.length && i < 60; i++) items.push(L[i]!); let s = 0; while (items.length > 0) s += items.pop()!; return [s, items]; }
function switched(q: number[], L: number[]): any { items = q; let s = 0; for (let i = 0; i < L.length && i < 20; i++) { items.push(L[i]!); if (i === 2) items = [7.5]; } return [items, q]; }
function constant(q: number[], L: number[]): any { fixed.length = 0; for (let i = 0; i < L.length && i < 60; i++) fixed.push(L[i]!); let s = 0; while (fixed.length > 0) s += fixed.pop()!; return [s, fixed]; }
function captured(q: number[], L: number[]): any { const take = () => { let s = 0; while (q.length > 0) s += q.pop()!; return s; }; for (let i = 0; i < L.length && i < 60; i++) q.push(L[i]!); return [take(), q]; }
function local(q: number[], L: number[]): any { const l = L.slice(); let s = 0; while (l.length > 0) s += l.pop()!; for (let i = 0; i < 5; i++) l.push(i / 2); return [s, l]; }
function object(q: number[], L: number[]): any { kept.items = q; for (let i = 0; i < L.length && i < 60; i++) kept.items.push(L[i]!); let s = 0; while (kept.items.length > 0) s += kept.items.pop()!; return [s, kept.items]; }
function counted(q: number[], L: number[]): any { kept.items = q; kept.n = 0; for (let i = 0; i < L.length && i < 60; i++) { kept.items.push(L[i]!); kept.n++; } return [kept.n, kept.items]; }
function replaced(q: number[], L: number[]): any { kept.items = q; for (let i = 0; i < L.length && i < 20; i++) { kept.items.push(L[i]!); if (i === 2) kept.items = [7.5]; } return [kept.items, q]; }
function moved(q: number[], L: number[]): any { state = { items: q, n: 0 }; let s = 0; for (let i = 0; i < L.length && i < 20; i++) { state.items.push(L[i]!); if (i === 3) state = { items: [1], n: 1 }; } while (state.items.length > 0) s += state.items.pop()!; return [s, state.items, q]; }
const withPush = (): any => Object.assign([1, 2], { push(this: any, x: number) { this[this.length] = x * 2; return 9; } });
const withPop = (): any => Object.assign([1, 2, 3], { pop(this: any) { this.length--; return 40; } });
const lists: (() => any)[] = [() => [], () => [1, 2, 3], () => [1.5, 2.5], () => ["a", "b"], () => [1, , 3], () => [1, "x", null], () => Object.freeze([1, 2]), () => Object.seal([1, 2]), () => JSON.parse("[4,3,2]"), () => JSON.parse("[4.5,3]"), () => new (class extends Array {})(3).fill(2), withPush, withPop, () => Object.defineProperty([1, 2, 3], 2, { get() { return 5.5; }, configurable: true }), () => [NaN, -0], () => new Proxy([1, 2], {}), () => Array.from({ length: 20 }, (_, i) => i / 3), () => Array.from({ length: 20 }, (_, i) => i), () => ({ length: 1, 0: 5, push(x: number) { (this as any)[(this as any).length++] = x; return 1; }, pop() { return (this as any)[--(this as any).length]; } })];
for (let turn = 0; turn < 2; turn++)
  for (const list of lists)
    for (const other of lists)
      for (const run of [filled, drained, both, bounded, monotonic, measured, rewritten, cut, past, answers, variable, switched, constant, captured, local, object, counted, replaced, moved]) {
        let said: string;
        try { const q = list(); said = show(run(q, turn && other === list ? q : other())); } catch (e) { said = "!" + (e as any).constructor.name; }
        console.log(run.name, said.slice(0, 80));
      }
