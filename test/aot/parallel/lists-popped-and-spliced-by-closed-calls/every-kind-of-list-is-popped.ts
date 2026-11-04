// Each kind of list popped until nothing is left, by a closed call: what comes out, and what the list is behind each step.
function popAny(list: any): unknown { return list.pop() }
function show(value: unknown): string { return typeof value === "object" && value !== null ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value) }
class Stack extends Array<number> { popped = 0; override pop() { this.popped++; return super.pop() } }
const above: any = []
const kinds: [string, () => any][] = [
  ["empty", () => []],
  ["int32s", () => [1, 2, 3]],
  ["doubles", () => [0.5, -0, NaN, 2 ** 40]],
  ["values", () => ["a", null, undefined, { b: 1 }, [2]]],
  ["a hole at the end", () => [1, 2, , ]],
  ["a hole in the middle", () => ["a", , "c"]],
  ["only holes", () => new Array(3)],
  ["int32s, then a text", () => { const list: unknown[] = [1, 2]; list.push("t"); return list }],
  ["a literal of constants, never written", () => [10, 20, 30]],
  ["frozen", () => Object.freeze([1, 2])],
  ["sealed", () => Object.seal([1, 2])],
  ["not extensible", () => Object.preventExtensions([1, 2])],
  ["length that cannot be written", () => Object.defineProperty([1, 2], "length", { writable: false })],
  ["last element that cannot be deleted", () => Object.defineProperty([1, 2], 1, { configurable: false })],
  ["a getter at the end", () => Object.defineProperty([1, 2], 1, { get() { return "got" }, configurable: true })],
  ["sparse", () => { const list: unknown[] = [1]; list[100000] = 2; return list }],
  ["cut by its length", () => { const list = [1, 2, 3, 4]; list.length = 2; return list }],
  ["grown by its length", () => { const list = [1]; list.length = 3; return list }],
  ["a class below Array", () => Stack.from([1, 2])],
  ["a method of its own", () => Object.assign([1, 2], { pop() { return "own" } })],
  ["below another list", () => { const list: unknown[] = [1, , ]; Object.setPrototypeOf(list, above); return list }],
  ["arguments-like", () => ({ length: 2, 0: "x", 1: "y", pop: Array.prototype.pop })],
  ["a name beside the elements", () => Object.assign([1, 2], { note: "n" })],
]
above[1] = "from above"
for (let round = 0; round < 3; round++) {
  for (const [name, make] of kinds) {
    const list = make()
    const steps: string[] = []
    for (let step = 0; step < 4; step++) {
      try { steps.push(show(popAny(list)) + "/" + list.length) } catch (error) { steps.push((error as Error).constructor.name + "/" + list.length) }
    }
    console.log(round, name + ":", steps.join(" "), show(Array.isArray(list) ? [...list] : list), list instanceof Stack ? list.popped : "")
  }
}
