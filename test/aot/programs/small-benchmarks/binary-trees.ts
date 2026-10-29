// The binary-trees benchmark: allocation and recursive calls.
class Node { left: Node | null; right: Node | null; constructor(l: Node | null, r: Node | null) { this.left = l; this.right = r } }
function make(d: number): Node { return d === 0 ? new Node(null, null) : new Node(make(d - 1), make(d - 1)) }
function check(t: Node): number { return t.left === null ? 1 : 1 + check(t.left) + check(t.right!) }
const t0 = performance.now()
const maxD = 18; let total = check(make(maxD + 1))
const long = make(maxD)
for (let d = 4; d <= maxD; d += 4) { const it = 1 << (maxD - d + 4); let c = 0; for (let i = 0; i < it; i++) c += check(make(d)); total += c }
console.log("trees", total + check(long), (performance.now() - t0).toFixed(0) + "ms")
