// The result array of map, filter, flatMap and the like is made by one shared piece of code, not by code at every call. Results of every length come out right: empty, one element, around the sizes where the allocator changes its way, and large.
// SIZE< threeResults 3200
type Point = { id: number }
const points: Point[] = [{ id: 0 }, { id: 1 }, { id: 2 }]
const numbers: number[] = points.map(p => p.id)
function threeResults(rounds: number): number {
  let total = 0
  for (let r = 0; r < rounds; r++) {
    const ids = points.map(p => p.id + r)
    const twice = numbers.map(x => x * 2)
    const some = points.filter(p => (p.id & 1) === 0)
    total += ids.length + twice[0] + some.length
  }
  return total
}
function squares(a: number[]): number[] { let out: number[] = []; for (let r = 0; r < 3; r++) out = a.map(x => x * x + r); return out }
function names(a: { id: number }[]): string[] { let out: string[] = []; for (let r = 0; r < 3; r++) out = a.map(x => "n" + (x.id + r)); return out }
function odd(a: number[]): number[] { let out: number[] = []; for (let r = 0; r < 3; r++) out = a.filter(x => (x + r) % 2 === 1); return out }
function halves(a: number[]): number[] { let out: number[] = []; for (let r = 0; r < 3; r++) out = a.map(x => x / 2 + r); return out }
function mixed(a: number[]): (number | string | undefined)[] { let out: (number | string | undefined)[] = []; for (let r = 0; r < 3; r++) out = a.map(x => x % 3 === 0 ? undefined : x % 3 === 1 ? x : "s" + x); return out }
let sum = 0
const lengths = [0, 1, 2, 3, 4, 5, 7, 8, 15, 16, 31, 63, 64, 126, 127, 128, 129, 255, 256, 500, 1000, 1005, 1006, 1007, 1008, 1009, 1010, 1020, 1023, 1024, 1025, 2047, 2048, 5000, 20000]
for (const n of lengths) {
  const a: number[] = []
  for (let i = 0; i < n; i++) a.push(i)
  const objects = a.map(id => ({ id }))
  const s = squares(a), m = names(objects), o = odd(a), h = halves(a), x = mixed(a)
  if (s.length !== n || m.length !== n || h.length !== n || x.length !== n) throw new Error("length " + n)
  for (let i = 0; i < n; i++) {
    if (s[i] !== i * i + 2 || m[i] !== "n" + (i + 2) || h[i] !== i / 2 + 2) throw new Error("element " + i + " of " + n)
    if (x[i] !== (i % 3 === 0 ? undefined : i % 3 === 1 ? i : "s" + i)) throw new Error("mixed element " + i + " of " + n)
  }
  sum += o.length + (n ? s[n - 1] % 7 : 0) + Object.keys(x).length
}
const holey = [1, , 3, , 5]
console.log(sum, JSON.stringify(holey.map(x => x! * 2)), 1 in holey.map(x => x), holey.filter(() => true).length)
let kept: number[][] = []
for (let round = 0; round < 3000; round++) {
  const a = [round, round + 1, round + 2].map(x => x + 1)
  if (round % 100 === 0) kept.push(a)
}
console.log(kept.length, kept[29].join(), threeResults(1000))
