// This must fail to build: `Swapped.prototype` is read in front of the store to it, which TypeScript 7 reports (TS2565). The same program with that one read
// through `any`, which builds and runs: reflect-construct-of-a-constructor-function-with-another-new-target.ts.
// Reflect.construct() of a constructor function with another new.target: the object inherits from what new.target has as its `prototype` and has what the function stores. Only where the function is its own new.target is the object one of its own.
const attempt = (label: string, run: () => unknown) => { try { console.log(label, String(run())) } catch (error) { console.log(label, "throws", (error as Error).constructor.name) } }

interface Pair { first: number; second: string }
function Pair(this: Pair, first: number, second: string) { this.first = first; this.second = second }
Pair.prototype.describe = function (this: Pair) { return "pair " + this.first + this.second }
const PairClass = Pair as unknown as new (first: number, second: string) => Pair
const read = (pair: Pair) => pair.second + pair.first
const tell = (made: any, target: any): string =>
  [Object.keys(made).join(), read(made), Object.getPrototypeOf(made) === target.prototype, made instanceof PairClass, typeof made.describe === "function" ? made.describe() : "nothing to call"].join(" ")

function Other(this: any) { this.never = "the body of new.target does not run" }
Other.prototype.describe = function (this: Pair) { return "other " + this.second }
class Modern { extra = 1; describe() { return "modern " + Object.keys(this).length } }
class Heir extends (Pair as any) { own = true }

console.log("new:", tell(new PairClass(1, "a"), Pair))
console.log("no new.target given:", tell(Reflect.construct(Pair, [2, "b"]), Pair))
console.log("itself:", tell(Reflect.construct(Pair, [3, "c"], Pair), Pair))
console.log("another function:", tell(Reflect.construct(Pair, [4, "d"], Other), Other))
console.log("a class:", tell(Reflect.construct(Pair, [5, "e"], Modern), Modern))
console.log("a class that extends it:", tell(Reflect.construct(Pair, [6, "f"], Heir), Heir))
console.log("Object:", tell(Reflect.construct(Pair, [7, "g"], Object), Object))
for (const builtin of [Array, Map, Date, Error, Promise, Function, Uint8Array]) {
  const made = Reflect.construct(Pair, [8, builtin.name], builtin)
  console.log(tell(made, builtin), made instanceof builtin, Array.isArray(made), Object.prototype.toString.call(made))
}
attempt("what needs a real map:", () => Reflect.construct(Pair, [9, "h"], Map).size)

const boundTarget = Other.bind(null), boundPair = (Pair as any).bind(null, 10)
console.log("a bound function, which has no prototype property:", tell(Reflect.construct(Pair, [11, "i"], boundTarget), Object))
console.log("the function when bound:", tell(Reflect.construct(boundPair, ["j"]), Pair), tell(Reflect.construct(boundPair, ["k"], boundPair), Pair), tell(Reflect.construct(boundPair, ["l"], Other), Other), tell(new (boundPair as any)("m"), Pair))

const asked: string[] = []
const watched = new Proxy(Other, { get(target, key, receiver) { asked.push("get " + String(key)); return Reflect.get(target, key, receiver) }, construct() { asked.push("construct"); return {} }, apply() { asked.push("apply") } })
console.log("a proxy:", tell(Reflect.construct(Pair, [(asked.push("first argument"), 12), (asked.push("second argument"), "n")], watched), Other), asked.join())
const watchedPair: any = new Proxy(Pair, { get(target, key, receiver) { asked.push("get " + String(key)); return Reflect.get(target, key, receiver) } })
asked.length = 0
console.log("a proxy of itself:", tell(new watchedPair(13, "o"), Pair), tell(Reflect.construct(Pair, [14, "p"], watchedPair), Pair), tell(Reflect.construct(watchedPair, [15, "q"], Pair), Pair), asked.join())
attempt("a prototype that throws when it is read:", () => Reflect.construct(Pair, [16, "r"], new Proxy(Other, { get() { throw new RangeError("read") } })))

for (const notAnObject of [5, "text", null, undefined, false, Symbol.for("s"), 1n]) {
  function Loose(this: any) {}
  Loose.prototype = notAnObject
  console.log("a prototype that is", typeof notAnObject + ":", tell(Reflect.construct(Pair, [17, "s"], Loose), Object))
}
function Swapped(this: any) {}
const before = Reflect.construct(Pair, [18, "t"], Swapped), earlier = Swapped.prototype
Swapped.prototype = { describe() { return "swapped" } }
const after = Reflect.construct(Pair, [19, "u"], Swapped)
console.log("a prototype that is replaced:", tell(before, { prototype: earlier }), tell(after, Swapped), before instanceof (Swapped as any), after instanceof (Swapped as any))

attempt("an arrow function:", () => Reflect.construct(Pair, [1, "a"], (() => 0) as any))
attempt("a method:", () => Reflect.construct(Pair, [1, "a"], ({ m() {} }).m as any))
attempt("an async function:", () => Reflect.construct(Pair, [1, "a"], (async function () {}) as any))
attempt("no function:", () => Reflect.construct(Pair, [1, "a"], {} as any))
attempt("undefined, written out:", () => Reflect.construct(Pair, [1, "a"], undefined as any))
attempt("no list:", () => (Reflect.construct as any)(Pair))
console.log("a list that is no array:", tell(Reflect.construct(Pair, { length: 2, 0: 20, 1: "v", 2: "ignored" } as any, Other), Other))
console.log("too few:", Object.keys(Reflect.construct(Pair, [], Other)).join(), JSON.stringify(Reflect.construct(Pair, [21], Modern)))

function Trapped(this: any) {}
const stores: string[] = []
Object.defineProperty(Trapped.prototype, "first", { set(value: number) { stores.push("first is set to " + value) }, get() { return "from the getter" } })
Object.defineProperty(Trapped.prototype, "second", { value: "read-only", writable: false })
attempt("new.target's prototype has a setter and a property that is read-only:", () => Reflect.construct(Pair, [22, "w"], Trapped))
console.log(stores.join())

interface Answer { value: number }
function Answer(this: Answer, value: number) { this.value = value; if (value > 100) return [value]; return undefined }
console.log("what the function returns:", JSON.stringify(Reflect.construct(Answer, [101], Other)), Array.isArray(Reflect.construct(Answer, [102], Answer)), JSON.stringify(Reflect.construct(Answer, [1], Other)), Reflect.construct(Answer, [2], Other) instanceof (Other as any))

const targets: Function[] = [Pair, Other, Modern, Pair, Heir, Pair]
let total = 0, ownObjects = 0
for (let round = 0; round < 12000; round++) {
  const made: Pair = Reflect.construct(Pair, [round, "z"], targets[round % targets.length])
  total += made.first + made.second.length + Object.keys(made).length
  if (Object.getPrototypeOf(made) === Pair.prototype) ownObjects++
}
console.log(total, ownObjects, tell(new PairClass(23, "x"), Pair))
/* Build errors:
error: TS2565: Property 'prototype' is used before being assigned.
*/
