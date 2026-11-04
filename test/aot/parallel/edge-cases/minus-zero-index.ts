// `table[-0]` is `table[0]`, also where the index is an optional member joined with a constant by `??`.
declare const console: { log(...values: unknown[]): void };
class Node { id: number; merge?: number; constructor(id: number, merge?: number) { this.id = id; if (merge !== undefined) this.merge = merge; } }
const table: string[] = ["t0", "t1", "t2"];
function f(n: Node): string { const z = n.merge ?? 1e21; const t = table[z]; return (t === undefined ? "none" : t) + "," + (z ? z | 0 : -1); }
function g(n: Node): string { const z = n.merge ?? 1e21; const t = table[z]; return t === undefined ? "none" : t; }
function h(z: number): string { const t = table[z]; return t === undefined ? "none" : t; }
let warm = 0; for (let i = 0; i < 300; i++) warm += f(new Node(i, i & 1 ? i & 1 : undefined)).length + g(new Node(i, i & 1)).length + h(i & 1).length;
console.log(warm, [0, -0, 1, 2, 3, 0.5, NaN].map(v => f(new Node(1, v)) + "|" + g(new Node(1, v)) + "|" + h(v)).join(" "));
