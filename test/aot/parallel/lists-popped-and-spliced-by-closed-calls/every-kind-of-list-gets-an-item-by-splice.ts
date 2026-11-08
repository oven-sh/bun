// `list.splice(at, 0, item)` by a closed call, at every place, into every kind of list: the answer, which is a new empty list each time, and the list behind it.
function insertAny(list: any, at: unknown, item: unknown): unknown { return list.splice(at, 0, item) }
function show(value: unknown): string { return JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : Object.is(v, -0) ? "-0" : v)) }
class Sorted extends Array<number> {}
const kinds: [string, () => any][] = [
  ["empty", () => []],
  ["int32s", () => [1, 2, 3]],
  ["int32s with room", () => { const list = [1, 2, 3]; list.push(4); list.pop(); return list }],
  ["values with room", () => { const list: unknown[] = ["a", "b", "c"]; list.push("d"); list.pop(); return list }],
  ["doubles with room", () => { const list = [0.5, 1.5]; list.push(2.5); list.pop(); return list }],
  ["a hole behind the place", () => { const list: unknown[] = ["a", , "c"]; list.push("d"); list.pop(); return list }],
  ["a hole in front of the place", () => { const list: unknown[] = [, "b", "c"]; list.push("d"); list.pop(); return list }],
  ["frozen", () => Object.freeze([1, 2])],
  ["sealed", () => Object.seal([1, 2])],
  ["not extensible", () => Object.preventExtensions([1, 2])],
  ["length that cannot be written", () => Object.defineProperty([1, 2], "length", { writable: false })],
  ["a literal of constants, never written", () => [10, 20, 30]],
  ["a class below Array", () => Sorted.from([1, 2, 3])],
  ["a constructor of its own", () => Object.assign([1, 2], { constructor: { [Symbol.species]: function (n: number) { return { made: n } } } })],
  ["a method of its own", () => Object.assign([1, 2], { splice() { return "own" } })],
  ["sparse", () => { const list: unknown[] = [1]; list[2000] = 2; return list }],
]
const places: unknown[] = [0, 1, 2, 3, 99, -1, -2, -99, 1.5, "1", undefined, null, NaN, -0]
const items: unknown[] = [7, 0.25, "t", undefined, null, { o: 1 }]
for (let round = 0; round < 2; round++) {
  for (const [name, make] of kinds) {
    const lines: string[] = []
    for (const at of places) {
      for (const item of items) {
        const list = make()
        let answer: unknown
        try { answer = insertAny(list, at, item) } catch (error) { answer = (error as Error).constructor.name }
        const short = list.length > 50 ? "length " + list.length : show([...list])
        lines.push(show(answer) + (Array.isArray(answer) ? answer.length : "") + short)
      }
    }
    console.log(round, name + ":", lines.join(" "))
  }
}
const grown: any = { list: [] as number[] }
const answers = new Set<unknown>()
for (let i = 0; i < 300; i++) answers.add(grown.list.splice((i * 7) % (i + 1), 0, i))
console.log(grown.list.length, answers.size, grown.list.slice(0, 12).join(), grown.list.reduce((a: number, b: number) => a + b, 0))
const kept: any = { list: ["a", "b"] }
const given = kept.list.splice(1, 0, "x")
given.push("mine")
console.log(show(given), show(kept.list), Object.getPrototypeOf(given) === Array.prototype)
