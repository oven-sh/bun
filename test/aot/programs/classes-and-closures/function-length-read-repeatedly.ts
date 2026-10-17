// How many parameters a function declares, asked of values whose type says nothing, again and again, before and after the property is changed.
class Shape { constructor(public w: number, public h: number) { } area(scale: number): number { return this.w * this.h * scale } static of(a: number, b: number, c: number): Shape { return new Shape(a + c, b) } get both(): number { return this.w + this.h } }
class Named { static length = 41; constructor(a: number) { void a } }
function three(a: number, b: number, c: number) { return a + b + c }
function withDefault(a: number, b = 2, c?: number) { return a + b + (c ?? 0) }
function withRest(a: number, ...rest: number[]) { return a + rest.length }
async function later(a: number, b: number) { return a + b }
function* yields(a: number) { yield a }
const arrow = (a: number, b: number, c: number, d: number) => a + b + c + d
const none = () => 0
function makeClosure(k: number) { return (a: number, b: number) => a + b + k }
const bound = three.bind(null, 1)
const boundTwice = bound.bind(null, 2)
const all: unknown[] = [three, withDefault, withRest, later, yields, arrow, none, makeClosure(1), makeClosure(2), bound, boundTwice, Shape, Shape.prototype.area, Shape.of, Named, Math.max, Array.prototype.push, parseInt,
  [1, 2, 3], "four", new Uint8Array(5), { length: 6 }, { length: "seven" }, new Map(), 8, true, Symbol.iterator, Object.getOwnPropertyDescriptor(Shape.prototype, "both")!.get]
function lengthOf(value: any): unknown { return value.length }
function takesMany(value: any): boolean { return value.length > 3 }
const rounds: string[] = []
for (let round = 0; round < 5; round++) rounds.push(all.map(lengthOf).join(","))
console.log(rounds[0]); console.log(rounds.every(line => line === rounds[0]))
let many = 0
for (let i = 0; i < 20000; i++) for (let k = 0; k < 9; k++) if (takesMany(all[k])) many++
console.log(many)
const changed = makeClosure(3) as any
console.log(lengthOf(changed), JSON.stringify(Object.getOwnPropertyDescriptor(changed, "length")), lengthOf(changed))
Object.defineProperty(changed, "length", { value: 9 })
console.log(lengthOf(changed), lengthOf(changed), changed(1, 2))
const removed = makeClosure(4) as any
console.log(lengthOf(removed), delete removed.length, lengthOf(removed), "length" in removed, Object.hasOwn(removed, "length"), removed(1, 2))
const assigned = makeClosure(5) as any
try { "use strict"; assigned.length = 7 } catch (error) { console.log((error as Error).constructor.name) }
console.log(lengthOf(assigned), Object.keys(assigned).length, lengthOf(makeClosure(6)))
const heir = Object.create(three)
console.log(lengthOf(heir), lengthOf(Object.setPrototypeOf(makeClosure(7), null)), lengthOf(Object.freeze(makeClosure(8))))
const withMore = makeClosure(9) as any; withMore.extra = 1
console.log(lengthOf(withMore), withMore.extra, withMore.name, lengthOf(withMore))
