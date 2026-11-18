function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Job = () => number;
let heldByModule: Job | undefined;
class Store {
  field?: Job;
  list: Job[] = [];
  byJob = new Map<Job, number>();
  weakly = new WeakMap<Job, number>();
  inField(f: Job): number { this.field = f; return 1; }
  inList(f: Job): number { this.list[this.list.length] = f; return 2; }
  asKey(f: Job): number { this.byJob.set(f, this.byJob.size); this.weakly.set(f, this.byJob.size); return 3; }
  inVariable(f: Job): number { heldByModule = f; return 4; }
  inClosure(f: Job): number { this.field = () => f() + 100; return 5; }
}
function field(store: any, k: number): number { const t = store.inField(() => k); return t + 1; }
function list(store: any, k: number): number { const t = store.inList(() => k); return t + 1; }
function key(store: any, k: number): number { const t = store.asKey(() => k); return t + 1; }
function variable(store: any, k: number): number { const t = store.inVariable(() => k); return t + 1; }
function closure(store: any, k: number): number { const t = store.inClosure(() => k); return t + 1; }

const store = new Store();
let all = 0;
for (let i = 0; i < 200; i++) all += field(store, i) + list(store, i) + key(store, i) + variable(store, i);
settle();
const keys = [...store.byJob.keys()];
console.log(all, store.field!(), store.list.length, store.list[0](), store.list[199](), heldByModule!(), store.byJob.size, keys[150](), store.byJob.get(keys[150]), store.weakly.get(keys[150]));
console.log(store.field === store.list[199], store.list[3] === store.list[4], store.list.includes(store.list[77]), store.byJob.has(store.list[77]), store.byJob.delete(keys[9]), store.byJob.delete(keys[9]), store.byJob.size, store.weakly.has(keys[9]));
for (let i = 0; i < 50; i++) all += closure(store, i);
settle();
console.log(all, store.field!());
