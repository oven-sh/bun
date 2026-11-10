class Node { v: number; constructor(v: number) { this.v = v; } get(n: number): number { return this.v + n; } }
const table: Record<string, Node> = { a: new Node(1), b: new Node(2.5) };
function at(k: string): number { const m = table[k]; return m ? m.get(1) + m.v : -1; }
const keys = "a b c a".split(" ");
let out = "";
for (let r = 0; r < 3; r++) for (let i = 0; i < keys.length; i++) out += at(keys[i]!) + " ";
console.log(out);
