// A lazily initialized value is tested for null or undefined only once on the usual path.
declare const console: any;
let table: number[] | undefined;
let made = 0;
function make(): number[] { made++; return [1, 2, 3, 4]; }
function assigned(i: number): number { let v = table; if (v == null) { v = table = make(); } return v[i & 3]; }
function reloaded(i: number): number { const v = table; let w: number[]; if (v == null) { table = make(); w = table!; } else w = v; return w[i & 3]; }
function truthy(i: number): number { let v = table; if (!v) { v = table = make(); } return v[i & 3]; }
function coalesced(i: number): number { const v = table ?? (table = make()); return v[i & 3]; }
interface Node { next: Node | null; value: number }
const chain: Node = { next: { next: null, value: 2 }, value: 1 };
function orItself(n: Node): number { const m = n.next == null ? n : n.next; return m.value; }
console.log(assigned(1), reloaded(2), truthy(3), coalesced(0), orItself(chain), orItself(chain.next!), made);
let t = 0;
for (let i = 0; i < 20000000; i++) t = (t + assigned(i) + reloaded(i) + truthy(i) + coalesced(i) + orItself(chain)) | 0;
console.log(t);
export {};
