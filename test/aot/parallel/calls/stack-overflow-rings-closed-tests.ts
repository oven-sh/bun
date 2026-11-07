// Recursion that never ends has to end in a RangeError that can be caught where the ring is closed through the tests in front of a typed function:
// the arguments come out of arrays, fields and values of type any, so no caller has proven them; some of them fit the declared types and some never do.
interface Item { kind: number; next: Item | undefined; items: Item[] }
let entered = 0
function attempt(name: string, run: () => number) {
  entered = 0
  let outcome: string
  try { outcome = "returned " + run() } catch (error) { outcome = error instanceof RangeError ? "RangeError" : "another error: " + error }
  console.log(name + ": " + outcome + ", went deep: " + (entered > 1000))
}
// The arrays are made where nobody sees what goes into them, so what is read out of them is an Item by its declared type alone.
const ring: Item = { kind: 1, next: undefined, items: JSON.parse("[]") }
const other: Item = { kind: 2, next: undefined, items: JSON.parse("[]") }
ring.items.push(other)
other.items.push(ring)
ring.next = ring.items[0]
other.next = other.items[0]
const outside: any = JSON.parse('{ "kind": "a text", "next": null, "items": [] }')
outside.next = outside
outside.items.push(outside)

function throughElements(item: Item): number { entered++; return item.kind + throughElements(item.items[0]) }
function throughFields(item: Item, depth: number): number { entered++; return depth + throughFields(item.next!, depth + 1) }
function small(item: Item): number { return middle(item.items[0], item.kind) + 1 }
function middle(item: Item, kind: number): number { entered++; return kind & 1 ? large(item.next!, item, kind) + 1 : large(item, item.next!, kind + 1) + 2 }
function large(a: Item, b: Item, kind: number): number {
  let sum = 0
  for (let i = 0; i < 3; i++) sum += (a.kind * i) ^ (b.kind + i) ^ (kind - i)
  if (sum === -1) return a.kind * b.kind
  return small(a.items[0]) + sum
}
function onlyHandsOn(item: Item): number { return readsIt(item) }
function readsIt(item: Item): number { entered++; return item.kind + onlyHandsOn(item.items[0]) }
function optional(item?: Item): number { entered++; return item ? optional(item.next) + 1 : 0 }
function throughAny(item: Item): number { entered++; const next: any = item.next; return throughAny(next) + 1 }
function neverFits(item: Item): number { entered++; return neverFits(item.next!) + 1 }
function fitsEverySecondTime(item: Item, turn: number): number { entered++; return fitsEverySecondTime(turn & 1 ? outside : ring, turn + 1) + 1 }
function level1(item: Item): number { return level2(item.items[0]) + 1 } function level2(item: Item): number { return level3(item.items[0]) + 1 }
function level3(item: Item): number { return level4(item.items[0]) + 1 } function level4(item: Item): number { return level5(item.items[0]) + 1 }
function level5(item: Item): number { return level6(item.items[0]) + 1 } function level6(item: Item): number { return level7(item.items[0]) + 1 }
function level7(item: Item): number { return level8(item.items[0]) + 1 } function level8(item: Item): number { return level9(item.items[0]) + 1 }
function level9(item: Item): number { return level10(item.items[0]) + 1 } function level10(item: Item): number { return level11(item.items[0]) + 1 }
function level11(item: Item): number { return level12(item.items[0]) + 1 } function level12(item: Item): number { entered++; return level1(item.items[0]) + item.kind }
class Walker {
  enter(item: Item): number { entered++; return this.visit(item.items[0]) + 1 }
  visit(item: Item): number { return item.next ? this.enter(item.next) : 0 }
}

attempt("elements of an array", () => throughElements(ring))
attempt("fields", () => throughFields(ring, 0))
attempt("small, middle, large", () => small(ring))
attempt("entered at the large one", () => large(ring, other, 1))
attempt("one only hands its argument on", () => onlyHandsOn(ring))
attempt("an optional parameter", () => optional(ring))
attempt("a value of type any", () => throughAny(ring))
attempt("arguments that never fit", () => neverFits(outside))
attempt("arguments that fit every second time", () => fitsEverySecondTime(ring, 0))
attempt("twelve functions in a row", () => level1(ring))
attempt("methods", () => new Walker().enter(ring))
for (let round = 0; round < 3; round++) attempt("again, round " + round, () => small(other) + level1(other))
