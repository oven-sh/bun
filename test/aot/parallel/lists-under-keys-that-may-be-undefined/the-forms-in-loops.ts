// Each form in a loop over typed records, with the key undefined at the end of each walk, and with stores into the records that the reads gave.
class Arc { to: number; cap: number; constructor(to: number, cap: number) { this.to = to; this.cap = cap; } }
const n = 40; const adj: Arc[][] = []; for (let i = 0; i < n; i++) adj.push(i + 1 < n ? [new Arc(i + 1, i), new Arc((i * 7 + 3) % n, 1)] : []);
function byShift(): number { const seen = new Uint8Array(n), queue: number[] = [0]; let s = 0; while (true) { const arcs = adj[queue.shift()!]; if (!arcs) return s; for (const a of arcs) { s += a.cap; a.cap += 1; if (!seen[a.to]) { seen[a.to] = 1; queue.push(a.to); } } } }
function byPop(): number { const seen = new Uint8Array(n), stack: number[] = [0]; let s = 0; while (true) { const arcs = adj[stack.pop()!]; if (!arcs) return s; for (const a of arcs) { s += a.cap; if (!seen[a.to]) { seen[a.to] = 1; stack.push(a.to); } } } }
function byGet(): number { const ids = new Map<string, number>(); for (let i = 0; i < n; i++) ids.set("k" + i, i); let s = 0; for (let i = 0; i <= n; i++) for (const a of adj[ids.get("k" + i)!] ?? []) s += a.to; return s; }
function byView(): number { const order = new Uint16Array(n); for (let i = 0; i < n; i++) order[i] = (i * 3) % n; let s = 0; for (let i = 0; i <= n; i++) s += adj[order[i]!]?.length ?? 100; return s; }
function byList(): number { const order: number[] = []; for (let i = 0; i < n; i++) order.push((i * 11) % n); let s = 0; for (let i = 0; i <= n; i++) s += adj[order[i]!]?.[0]?.cap ?? 1000; return s; }
function byParent(): number { const parent: (number | null)[] = [null]; for (let i = 1; i < n; i++) parent.push(i >> 1); let s = 0, at: number | null = n - 1; while (at !== null) { s += adj[at]!.length + at; at = parent[at]!; } return s + (adj[at as unknown as number] === undefined ? 1 : 0); }
function byTuple(): number { const stack: [number, number][] = [[0, 0]]; let s = 0; while (stack.length) { const [v, depth] = stack.pop()!; s += adj[v]!.length; if (depth < 3) for (const a of adj[v]!) stack.push([a.to, depth + 1]); } return s; }
console.log(byShift(), byPop(), byGet(), byView(), byList(), byParent(), byTuple(), byShift());
