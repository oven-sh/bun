// A counter that is incremented in a loop never passes 2^53.
function evens(n: number) { let i = 0, turns = 0; while (i < n) { i += 2; turns++ } return [i, turns].join() }
function most(n: number) { let i = 0; while (i < n) i += 1024; return i }
function down(n: number) { let i = 0; for (let k = 0; k < n; k++) i -= 3; return i }
function either(text: string) { let pos = 0, count = 0; while (pos < text.length) { pos += text.charCodeAt(pos) > 0x7f ? 2 : 1; count++ } return [pos, count].join() }
function back(n: number) { let i = 0; for (let k = 0; k < n; k++) i = 7 + i; return i }
function beyond(n: number) { let i = 0; while (i < n) i += 1025; return i }
function doubling(n: number) { let x = 1; for (let k = 0; k < n; k++) x = x + x; return x }
function by(n: number, turns: number) { let i = 0; for (let k = 0; k < turns; k++) i += n; return i }
function far(turns: number) { let i = 9007199254739000; for (let k = 0; k < turns; k++) i += 1025; return i }
function edge(a: number, b: number) { const p = ((a & 0x7ffffff) + 1) * ((b & 0x3ffffff) + 1); return [p, p + 1, p + 2, p + 1 === p, p + 3].join() }
function top(up: boolean) { const t = up ? 9007199254740991 : 9007199254740990; return [t + 1, t + 2, t + 3, t + 1 === t + 2].join() }
function fromAny(o: any) { let i = o.start; for (let k = 0; k < 3; k++) i += 2; return i }
function fromJSON(text: string) { let i: number = JSON.parse(text); for (let k = 0; k < 3; k++) i += 2; return i }
function halves(n: number) { let i = n / 2; for (let k = 0; k < 3; k++) i += 2; return i }
function zero(n: number) { let i = -(n & 0); for (let k = 0; k < 3; k++) i -= 0; return Object.is(i, -0) }
function unsigned(n: number) { let i = -n >>> 0; for (let k = 0; k < 3; k++) i += 2; return i }
function early() { return late + 2 }
const before = early()
var late = 0
late += 2
const n = Number("37")
console.log(evens(n), most(n * 100), down(n), either("aé b"), back(n))
console.log(beyond(n * 100), doubling(n), doubling(n + 30), by(0.5, n), by(n, n))
console.log(far(0), far(1), far(2), far(3), far(n))
console.log(fromAny({ start: 0.5 }), fromAny({ start: "a" }), fromJSON("1.25"), halves(n), zero(n), unsigned(n), before, early())
console.log(edge(0x7ffffff, 0x3ffffff), edge(n, n), top(n > 1), top(n < 1))
