function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Job = () => number;
function push(bag: Job[], k: number): number { const n = bag.push(() => k); return n + 1; }
function pushToAnything(bag: any, k: number): number { const n = bag.push(() => k + 1); return n + 1; }
function unshift(bag: any, k: number): number { const n = bag.unshift(() => k + 2); return n + 1; }
function add(set: Set<Job>, k: number): number { const same = set.add(() => k + 3); return same.size + 1; }
function addToAnything(set: any, k: number): number { const same = set.add(() => k + 4); return same.size + 1; }
function put(map: Map<number, Job>, k: number): number { const same = map.set(k, () => k + 5); return same.size + 1; }
function putUnder(map: any, k: number): number { const same = map.set(() => k + 6, () => k + 7); return same.size + 1; }
function fill(bag: any, k: number): number { const same = bag.fill(() => k + 8); return same.length + 1; }
function joined(bag: any, k: number): Job[] { const made = bag.concat(() => k + 9, () => k + 10); return made; }

const bag: Job[] = [], front: Job[] = [], set = new Set<Job>(), map = new Map<number, Job>(), under = new Map<Job, Job>(), filled: Job[] = new Array(3);
let all = 0, made: Job[] = [];
for (let i = 0; i < 120; i++) { all += push(bag, i) + pushToAnything(bag, i) + unshift(front, i) + add(set, i) + addToAnything(set, i) + put(map, i) + putUnder(under, i) + fill(filled, i); made = joined(made.slice(-4), i); }
settle();
const sum = (jobs: Iterable<Job>) => { let t = 0; for (const job of jobs) t += job(); return t; };
console.log(all, bag.length, sum(bag), front.length, sum(front), set.size, sum(set), map.size, sum(map.values()), under.size, sum(under.keys()), sum(under.values()));
console.log(filled[0] === filled[2], filled[0](), made.length, sum(made), new Set(bag).size, bag.indexOf(bag[100]), set.delete(bag[0]), set.delete([...set][0]), set.size, under.get([...under.keys()][50])!());
