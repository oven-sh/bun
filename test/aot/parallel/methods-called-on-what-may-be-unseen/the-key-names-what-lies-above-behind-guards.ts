class Node { v: number; calls = 0; constructor(v: number) { this.v = v; } get(n: number): number { this.calls++; return this.v + n; } }
const table: Record<string, Node> = { a: new Node(1), b: new Node(2.5) };
function at(k: string): number { const m = table[k]; if (!m) return -1; if (typeof m === "function") return -2; if (k.length === 9) return -3; return m.get(1) + m.v; }
const keys = "a b c constructor toString valueOf hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString __proto__ __defineGetter__ __defineSetter__ __lookupGetter__ __lookupSetter__ a".split(" ");
let out = "";
for (let r = 0; r < 3; r++) for (let i = 0; i < keys.length; i++) out += at(keys[i]!) + " ";
console.log(out, table.a!.v, table.a!.calls, table.b!.v, table.b!.calls);
