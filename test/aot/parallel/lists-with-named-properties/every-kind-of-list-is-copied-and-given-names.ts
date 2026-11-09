// Every kind of receiver of a closed `slice()` whose answer is stored into by name at once, and what becomes of the copy afterwards: more names than the room holds, more elements than its vector, deletes, freezes, lengths.
function copyAndName(list: any): any {
  const copy = list.slice()
  copy.first = 1
  copy.second = "two"
  return copy
}
function copyOrSame(list: any, copies: boolean): any {
  const result = copies ? list.slice() : list
  result.mark = copies
  return result
}
function show(value: any): string {
  const names = typeof value === "object" && value !== null ? Object.keys(value).join() : ""
  return JSON.stringify(value) + " {" + names + "} " + (Array.isArray(value) ? value.length : typeof value)
}
class Sub extends Array<number> {}
const kinds: [string, () => any][] = [
  ["empty", () => []],
  ["one int32", () => [1]],
  ["int32s", () => [1, 2, 3, 4]],
  ["five", () => [1, 2, 3, 4, 5]],
  ["doubles", () => [0.5, 1.5]],
  ["values", () => ["a", { b: 1 }, null]],
  ["holes", () => [1, , 3]],
  ["a long list", () => Array.from({ length: 100 }, (_, i) => i)],
  ["a literal of constants", () => [10, 20, 30]],
  ["a list with names of its own", () => Object.assign([1, 2], { note: "n" })],
  ["frozen", () => Object.freeze([1, 2])],
  ["a class below Array", () => Sub.from([1, 2])],
  ["a species of its own", () => Object.assign([1, 2], { constructor: { [Symbol.species]: function (n: number) { return { made: n } } } })],
  ["a method of its own", () => Object.assign([1, 2], { slice() { return { own: true } } })],
  ["sparse", () => { const list: unknown[] = [1]; list[3000] = 2; return list }],
  ["a text", () => "text"],
  ["a typed array", () => new Uint8Array([1, 2, 3])],
  ["an object with slice", () => ({ slice() { return [9] } })],
]
for (let round = 0; round < 3; round++) {
  for (const [name, make] of kinds) {
    const lines: string[] = []
    for (const act of [copyAndName, (list: any) => copyOrSame(list, true), (list: any) => copyOrSame(list, false)]) {
      try {
        const source = make()
        const copy = act(source)
        const short = (value: any) => (value && value.length > 20 ? "length " + value.length + " {" + Object.keys(value).slice(-3).join() + "}" : show(value))
        lines.push(short(copy) + (copy === source ? " same" : ""))
      } catch (error) { lines.push((error as Error).constructor.name) }
    }
    console.log(round, name + ":", lines.join(" | "))
  }
}
const steps: [string, (copy: any) => unknown][] = [
  ["six names", copy => { copy.third = 3; copy.fourth = 4; copy.fifth = 5; copy.sixth = 6; return copy.sixth }],
  ["many elements", copy => { for (let i = 0; i < 40; i++) copy.push(i); return copy.length }],
  ["elements, then names", copy => { copy.push(7, 8, 9, 10, 11, 12); copy.third = 3; copy.fourth = 4; copy.fifth = 5; return copy.fifth }],
  ["a name deleted", copy => { delete copy.first; copy.third = 3; return "first" in copy }],
  ["all names deleted", copy => { delete copy.first; delete copy.second; copy.again = 1; return Object.keys(copy).length }],
  ["cut", copy => { copy.length = 0; copy.push("x"); return copy.second }],
  ["grown by its length", copy => { copy.length = 50; return copy.second }],
  ["an index far away", copy => { copy[5000] = 1; return copy.first }],
  ["unshift and shift", copy => { copy.unshift(0, 0, 0); copy.shift(); return copy.first }],
  ["splice", copy => { copy.splice(1, 0, "in"); return copy.second }],
  ["a double into int32s", copy => { copy[0] = 0.5; return copy.first }],
  ["a text into int32s", copy => { copy[0] = "t"; return copy.second }],
  ["frozen", copy => { Object.freeze(copy); try { copy.third = 3 } catch {} return Object.isFrozen(copy) }],
  ["a getter", copy => { Object.defineProperty(copy, "got", { get() { return this.first + 1 }, enumerable: true }); return copy.got }],
  ["a symbol", copy => { copy[Symbol.for("s")] = 1; return Object.getOwnPropertySymbols(copy).length }],
  ["copied again", copy => show(copyAndName(copy))],
  ["spread", copy => show([...copy]) + show({ ...copy })],
  ["sorted and reversed", copy => { copy.sort().reverse(); return copy.second }],
]
for (const source of [[1], [1, 2, 3], ["a", "b"], [0.5, 1.5, 2.5, 3.5]]) {
  for (const [name, step] of steps) {
    const copy = copyAndName(source)
    const answer = step(copy)
    console.log(name + ":", String(answer), copy.length > 20 ? "length " + copy.length + " {" + Object.keys(copy).slice(-4).join() + "}" : show(copy))
  }
}
