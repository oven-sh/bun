// A small utility that calls its function argument in a loop is inlined into callers that pass a known function, even when the caller itself has no loop.
// IRT= 1 withLiteral = LoopHint
// IRT= 0 withLiteral = Call v
// IRT= 0 withLiteral = NewClosure \(.*\) function=f
// IRT= 1 withDeclared = LoopHint
// IRT= 0 withDeclared = Call v
// IRT= 1 withTwo = LoopHint
// IRT= 0 withTwo = Call v
// IRT= 0 withUnknown = LoopHint
// IRT= 0 withLarge = LoopHint
// IRT= 1 withLarge = NewClosure \(.*\) function=f
class N { constructor(public id: number, public parent: N | undefined) { } }
function up(n: N | undefined, f: (n: N) => boolean): N | undefined { while (n) { if (f(n)) return n; n = n.parent } return undefined }
function total(xs: readonly N[], f: (n: N) => number): number { let s = 0; for (let i = 0; i < xs.length; i++) s += f(xs[i]); return s }
function search(xs: readonly N[], key: number, keyOf: (n: N) => number, compare: (a: number, b: number) => number): number {
    let low = 0, high = xs.length - 1
    while (low <= high) { const middle = low + ((high - low) >> 1), c = compare(keyOf(xs[middle]), key); if (c < 0) low = middle + 1; else if (c > 0) high = middle - 1; else return middle }
    return ~low
}
function large(xs: readonly N[], f: (n: N) => number): number {
    let a = 0, b = 1, c = 2, d = 3
    for (let i = 0; i < xs.length; i++) {
        const v = f(xs[i]); a += v * b + c; b ^= a >> 1; c = (c + d * v) | 0; d = (d - a + b) | 0; a = (a * 31 + b * 17 + c * 13 + d * 7) | 0; b = (b + (a & 255) + (c & 127) + (d & 63)) | 0
        if (a > b) c = (c + a - b) | 0; else d = (d + b - a) | 0
        if (c > d) a = (a ^ c ^ d) | 0; else b = (b ^ c ^ d) | 0
        a = (a + v) | 0; b = (b - v) | 0; c = (c * 3 + v) | 0; d = (d * 5 - v) | 0
    }
    return (a + b + c + d) | 0
}
function idOf(n: N): number { return n.id }
function byNumber(a: number, b: number): number { return a < b ? -1 : a > b ? 1 : 0 }
function withLiteral(n: N, wanted: number): N | undefined { return up(n, m => m.id === wanted) }
function withDeclared(xs: readonly N[]): number { return total(xs, idOf) }
function withTwo(xs: readonly N[], key: number): number { return search(xs, key, idOf, byNumber) }
function withUnknown(xs: readonly N[], key: number, keyOf: (n: N) => number, compare: (a: number, b: number) => number): number { return search(xs, key, keyOf, compare) }
function withLarge(xs: readonly N[], k: number): number { return large(xs, n => n.id + k) }
const g: any = globalThis; g.keep = [withLiteral, withDeclared, withTwo, withUnknown, withLarge, up, total, search, large, idOf, byNumber]
const root = new N(1, undefined), middle = new N(2, root), leaf = new N(3, middle), all = [root, middle, leaf]
console.log(withLiteral(leaf, 1)?.id, withLiteral(leaf, 9)?.id, withDeclared(all), withTwo(all, 2), withTwo(all, 7), withUnknown(all, 3, g.keep[9], g.keep[10]), withLarge(all, 4))
export {}
