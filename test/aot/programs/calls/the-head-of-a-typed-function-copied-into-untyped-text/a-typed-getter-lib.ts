export class Item { constructor(public next: Item | null, public v: number, public w: number) {} }
let sink = 0
let turn = 0
let kept: Item | null | undefined = undefined
let keptNumber: number | undefined = undefined
let keptText: string | undefined = undefined
let keptItem: Item | undefined = undefined
function work(a: number, b: number): number { sink = (sink + a * 31 + b) & 1023; return sink }
function much(k: number): number {
    const a = work(1, k), b = work(a, 2), c = work(b, a), d = work(c, b), e = work(d, c), f = work(e, d), g = work(f, e), h = work(g, f)
    return work(h, g) + work(a, c) + work(b, d) + work(c, e) + work(d, f) + work(e, g) + work(f, h) + work(g, a) + work(h, b)
}
export function current(): Item | null | undefined {
    if (kept !== undefined) return kept
    const k = turn++
    const a = work(1, k), b = work(a, 2), c = work(b, a), d = work(c, b), e = work(d, c), f = work(e, d), g = work(f, e), h = work(g, f)
    const p = work(h, g) + work(a, c) + work(b, d) + work(c, e) + work(d, f) + work(e, g) + work(f, h) + work(g, a) + work(h, b)
    const q = work(p, a) + work(p, b) + work(p, c) + work(p, d) + work(p, e) + work(p, f) + work(p, g) + work(p, h)
    if ((k & 3) === 1) { kept = null; return kept }
    if ((k & 3) === 2) return undefined
    kept = new Item(new Item(null, p & 15, 4), q & 15, 2)
    return kept
}
export function currentNumber(): number {
    if (keptNumber !== undefined) return keptNumber
    const k = turn++
    const a = work(1, k), b = work(a, 2), c = work(b, a), d = work(c, b), e = work(d, c), f = work(e, d), g = work(f, e), h = work(g, f)
    const p = work(h, g) + work(a, c) + work(b, d) + work(c, e) + work(d, f) + work(e, g) + work(f, h) + work(g, a) + work(h, b)
    const q = work(p, a) + work(p, b) + work(p, c) + work(p, d) + work(p, e) + work(p, f) + work(p, g) + work(p, h)
    keptNumber = (k & 1) ? p + 0.5 : q
    return keptNumber
}
export function currentText(): string {
    if (keptText !== undefined) return keptText
    const k = turn++
    const a = work(1, k), b = work(a, 2), c = work(b, a), d = work(c, b), e = work(d, c), f = work(e, d), g = work(f, e), h = work(g, f)
    const p = work(h, g) + work(a, c) + work(b, d) + work(c, e) + work(d, f) + work(e, g) + work(f, h) + work(g, a) + work(h, b)
    const q = work(p, a) + work(p, b) + work(p, c) + work(p, d) + work(p, e) + work(p, f) + work(p, g) + work(p, h)
    keptText = "t" + (p & 7) + "-" + (q & 7)
    return keptText
}
export function currentItem(): Item {
    if (keptItem !== undefined) return keptItem
    const k = turn++
    const a = work(1, k), b = work(a, 2), c = work(b, a), d = work(c, b), e = work(d, c), f = work(e, d), g = work(f, e), h = work(g, f)
    const p = work(h, g) + work(a, c) + work(b, d) + work(c, e) + work(d, f) + work(e, g) + work(f, h) + work(g, a) + work(h, b)
    const q = work(p, a) + work(p, b) + work(p, c) + work(p, d) + work(p, e) + work(p, f) + work(p, g) + work(p, h)
    keptItem = new Item(null, p & 31, (q + much(k)) & 31)
    return keptItem
}
export function forget(): void { kept = undefined; keptNumber = undefined; keptText = undefined; keptItem = undefined }
