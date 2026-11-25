// In front of the read the turn has already done something that can be seen: counted, pushed, stored into a field, into the view itself, called somebody. Where the position then lies outside, nothing of that may happen twice.
class Tally { turns = 0; notes: number[] = []; words: Int32Array; constructor(n: number) { this.words = new Int32Array(n).fill(7) } }
function counts(tally: Tally, n: number): number { let sum = 0; for (let i = 0; i < n; i++) { tally.turns++; sum = (sum + tally.words[i * 2]!) | 0 } return sum }
function pushes(tally: Tally, n: number): number { let sum = 0; for (let i = 0; i < n; i++) { tally.notes.push(i); sum = (sum + tally.words[i * 2]!) | 0 } return sum }
function stores(tally: Tally, n: number): number { let sum = 0; const words = tally.words; for (let i = 0; i < n; i++) { words[i] = words[i]! + 1; sum = (sum + words[i * 2]!) | 0 } return sum }
function calls(tally: Tally, n: number, each: (i: number) => void): number { let sum = 0; for (let i = 0; i < n; i++) { each(i); sum = (sum + tally.words[i * 2]!) | 0 } return sum }
function twoReads(tally: Tally, n: number): number { let sum = 0; const words = tally.words; for (let i = 0; i < n; i++) { const first = words[i]!; tally.turns += first; sum = (sum + first + words[i * 3]!) | 0 } return sum }
(globalThis as any).kit = { Tally, counts, pushes, stores, calls, twoReads }
const kit = (globalThis as any).kit
for (let round = 0; round < 2; round++) for (const n of [0, 2, 3, 4, 6, 9]) {
  const a = new kit.Tally(6), b = new kit.Tally(6), c = new kit.Tally(6), d = new kit.Tally(6), e = new kit.Tally(6)
  const heard: number[] = []
  console.log(n, kit.counts(a, n), a.turns, kit.pushes(b, n), b.notes.join(""), kit.stores(c, n), Array.from(c.words).join(""), kit.calls(d, n, (i: number) => heard.push(i)), heard.join(""), kit.twoReads(e, n), e.turns)
}
