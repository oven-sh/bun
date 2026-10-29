// `const self = Object.create(Proto); self.a = a; return self`: the object is born as the record that the declared type names, with Proto as its
// prototype. No program can tell: the order of the keys, what a setter, a read-only property or a Proxy on the prototype chain sees between the
// stores, an exception halfway, the object escaping before its last store, a prototype that changes later.
const log: string[] = []
const show = (label: string, value: unknown) => log.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)))
const describe = (o: object) =>
  Object.keys(o).join() + " | " + JSON.stringify(o) + " | " + Object.getOwnPropertyNames(o).join() + " | " + Reflect.ownKeys(o).map(String).join()

interface Ref<A> {
  readonly kind: string
  describe(): string
  value: A
  count: number
}
const RefProto = {
  kind: "Ref",
  describe(this: Ref<unknown>) {
    return this.kind + ":" + String(this.value) + ":" + this.count
  },
}
function makeRef<A>(value: A, count: number): Ref<A> {
  const self = Object.create(RefProto)
  self.value = value
  self.count = count
  return self
}
function sum(ref: Ref<number>): number {
  return ref.value + ref.count
}
let total = 0
for (let i = 0; i < 300; i++) total += sum(makeRef(i, 1))
show("sum", total)
const one = makeRef("a", 7)
show("one", describe(one))
show("one.describe", one.describe())
show("one.kind", one.kind + " " + ("kind" in one) + " " + Object.hasOwn(one, "kind") + " " + Object.hasOwn(one, "value"))
show("one's prototype", Object.getPrototypeOf(one) === RefProto)
show("one's descriptor", Object.getOwnPropertyDescriptor(one, "count"))
for (const key in one) log.push("for-in " + key)

const annotated = (value: number): Ref<number> => {
  const self: Ref<number> = Object.create(RefProto)
  self.count = 2
  self.value = value
  return self
}
show("annotated", describe(annotated(5)) + " " + sum(annotated(5)))
type Mutable<T> = { -readonly [K in keyof T]: T[K] }
const asserted = (value: number) => {
  const self = Object.create(RefProto) as Mutable<Ref<number>>
  self.value = value
  self.count = 3
  self.kind = "own kind"
  return self
}
show("asserted", describe(asserted(5)) + " " + asserted(1).describe())

function eitherOrder(first: boolean): Ref<number> {
  const self = Object.create(RefProto)
  if (first) {
    self.value = 1
    self.count = 2
  } else {
    self.count = 2
    self.value = 1
  }
  return self
}
show("either order", describe(eitherOrder(true)) + " / " + describe(eitherOrder(false)))

function withMore(): Ref<number> {
  const self = Object.create(RefProto)
  self.extra = "e"
  self.value = 1
  self[7] = "seven"
  self.count = 2
  return self
}
show("with more", describe(withMore()))

function lacksCount(): Ref<number> {
  const self = Object.create(RefProto)
  self.value = 4
  return self
}
show("lacks a field", describe(lacksCount()) + " " + ("count" in lacksCount()) + " " + String((lacksCount() as any).count))

interface Seen {
  a: number
  b: number
}
const seen: string[] = []
const WithSetter = {
  set a(value: number) {
    seen.push("set a " + value + " on " + Object.keys(this).join())
  },
  get a() {
    return 40
  },
}
function makeSeen(a: number, b: number): Seen {
  const self = Object.create(WithSetter)
  self.b = b
  self.a = a
  return self
}
const throughSetter = makeSeen(1, 2)
show("a setter on the prototype", describe(throughSetter) + " " + throughSetter.a + " " + throughSetter.b + " " + seen.join(";"))
const addSeen = (s: Seen) => s.a + s.b
show("read through the getter", addSeen(makeSeen(5, 6)))

const ReadOnly = Object.freeze({ a: 9 })
function makeOverReadOnly(): Seen {
  const self = Object.create(ReadOnly)
  self.b = 1
  self.a = 2
  return self
}
try {
  show("over a read-only property", describe(makeOverReadOnly()))
} catch (error) {
  show("over a read-only property", (error as Error).constructor.name)
}

const traps: string[] = []
const proxied: object = new Proxy(
  {},
  {
    set(target, key, value, receiver) {
      traps.push("set " + String(key) + "=" + value + " keys " + Object.keys(receiver).join())
      return Reflect.set(target, key, value, receiver)
    },
    get(target, key, receiver) {
      traps.push("get " + String(key))
      return Reflect.get(target, key, receiver)
    },
  },
)
function makeOverProxy(a: number, b: number): Seen {
  const self = Object.create(proxied)
  self.a = a
  self.b = self.a + b
  return self
}
show("over a Proxy", describe(makeOverProxy(1, 2)) + " " + traps.join(";"))

const Later: object = {}
const later: any = Later
function makeLater(a: number, b: number): Seen {
  const self = Object.create(Later)
  self.a = a
  self.b = b
  return self
}
for (let i = 0; i < 50; i++) makeLater(i, i)
show("before the prototype changes", describe(makeLater(1, 2)))
Object.defineProperty(Object.getPrototypeOf(makeLater(0, 0)), "a", {
  set(value: number) {
    seen.push("late set a " + value)
  },
  configurable: true,
})
seen.length = 0
show("after it got a setter", describe(makeLater(1, 2)) + " " + seen.join(";"))
delete later.a
show("after the setter went", describe(makeLater(1, 2)))
Object.setPrototypeOf(Later, {
  set b(value: number) {
    seen.push("far set b " + value)
  },
})
seen.length = 0
show("after its own prototype changed", describe(makeLater(1, 2)) + " " + seen.join(";"))
Object.setPrototypeOf(Later, Object.prototype)
later.a = 5
Object.freeze(Later)
try {
  show("after it was frozen", describe(makeLater(1, 2)))
} catch (error) {
  show("after it was frozen", (error as Error).constructor.name)
}

const Plain = { tag: "plain" }
interface Pair {
  readonly tag: string
  left: number
  right: number
}
let leaked: Pair | undefined
function fails(): number {
  throw new RangeError("halfway")
}
function makeHalf(): Pair {
  const self = Object.create(Plain)
  self.left = 1
  self.right = fails()
  return self
}
try {
  makeHalf()
} catch (error) {
  show("an exception halfway", (error as Error).message + " " + String(leaked))
}
const registry: Pair[] = []
function makeRegistered(): Pair {
  const self = Object.create(Plain)
  self.left = 1
  registry.push(self)
  show("seen before its last store", describe(registry[0]!) + " " + String(registry[0]!.right))
  self.right = 2
  return self
}
show("registered", describe(makeRegistered()) + " " + (registry[0]!.left + registry[0]!.right))

function makeOfItself(): { self: unknown; n: number } {
  const made = Object.create(Plain)
  made.self = made
  made.n = Object.keys(made).length
  return made
}
show("holds itself", makeOfItself().self === undefined ? "lost" : Object.keys(makeOfItself()).join() + " " + makeOfItself().n)

interface Stamp {
  readonly tag: string
  millis: number
  parts?: number[] | undefined
}
function makeStamp(millis: number): Stamp {
  const self = Object.create(Plain)
  self.millis = millis
  Object.defineProperty(self, "parts", { value: undefined, enumerable: false, writable: true })
  return self
}
const stamp = makeStamp(12)
show("a hidden property", describe(stamp) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(stamp, "parts")))
stamp.parts = [1]
show("a hidden property, stored to", describe(stamp) + " " + stamp.parts.length + " " + stamp.millis)
let millis = 0
for (let i = 0; i < 200; i++) millis += makeStamp(i).millis
show("stamps", millis)

function makeFrozen(left: number): Pair {
  const self = Object.create(Plain)
  self.left = left
  self.right = 0
  return Object.freeze(self)
}
const frozen = makeFrozen(3)
try {
  frozen.left = 4
} catch (error) {
  show("frozen", (error as Error).constructor.name + " " + Object.isFrozen(frozen) + " " + describe(frozen))
}

const TypeId: unique symbol = Symbol.for("born/TypeId")
interface Branded {
  readonly [TypeId]: string
  name: string
}
const BrandedProto = { toString() { return "Branded" } }
function makeBranded(name: string): Branded {
  const self = Object.create(BrandedProto)
  self[TypeId] = "brand"
  self.name = name
  return self
}
show("a symbol for a key", describe(makeBranded("n")) + " " + makeBranded("n")[TypeId] + " " + String(makeBranded("m")))

function shadowed(): Pair {
  const Object = { create: (_: object) => ({ tag: "fake", left: 0, right: 0 }) }
  const self = Object.create(Plain)
  self.left = 1
  return self
}
show("another Object", describe(shadowed()))
function notAnObject(prototype: any): Pair {
  const self = Object.create(prototype)
  self.left = 1
  self.right = 2
  return self
}
try {
  notAnObject(undefined)
} catch (error) {
  show("no object for a prototype", (error as Error).constructor.name)
}
show("null for a prototype", describe(notAnObject(null)) + " " + String(Object.getPrototypeOf(notAnObject(null))))
show("a function for a prototype", describe(notAnObject(function named() {})) + " " + (notAnObject(function named() {}) as any).name)

function twoWaysOut(early: boolean): Pair {
  const self = Object.create(Plain)
  self.left = 1
  if (early) return self
  self.right = 2
  return self
}
show("two ways out", describe(twoWaysOut(true)) + " / " + describe(twoWaysOut(false)) + " " + twoWaysOut(false).tag)
const untyped: any = makeRef(1, 2)
untyped.more = 3
delete untyped.value
show("in untyped hands", describe(untyped) + " " + untyped.describe())
show("spread and assign", JSON.stringify({ ...makeRef(1, 2) }) + " " + JSON.stringify(Object.assign({}, makeRef(3, 4))) + " " + JSON.stringify(Object.entries(makeRef(5, 6))))

interface Node {
  readonly tag: string
  root: Node | undefined
  depth: number
  children: Map<string, Node>
  label: string
}
const order: string[] = []
const said = <T>(label: string, value: T): T => {
  order.push(label)
  return value
}
function makeNode(root: Node | undefined, depth: number): Node {
  const self: Node = Object.create(Plain)
  self.root = root ?? self
  self.depth = depth
  self.children = new Map()
  self.label = depth === 0 ? "top" : typeof root
  return self
}
const top = makeNode(undefined, 0)
show("holds itself from the first store on", Object.keys(top).join() + " " + (top.root === top) + " " + makeNode(top, 1).label + " " + (makeNode(top, 1).root === top) + " " + top.children.size)
function makeFirstByCall(depth: number): Node {
  const self = Object.create(said("the prototype", Plain))
  self.label = said("label", "l" + depth)
  self.depth = depth
  self.children = said("children", new Map())
  self.root = undefined
  return self
}
show("values that run code", describe(makeFirstByCall(2)) + " " + order.join())
let nodes = 0
for (let i = 0; i < 300; i++) nodes += makeNode(top, i).depth + makeFirstByCall(i).label.length
show("nodes", nodes)

function assigned(left: number, right: number): Pair {
  return Object.assign(Object.create(Plain), { right, left })
}
show("assigned", describe(assigned(1, 2)) + " " + assigned(1, 2).tag + " " + (assigned(3, 4).left + assigned(3, 4).right))
order.length = 0
const assignedInOrder = (): Pair => Object.assign(Object.create(said("prototype", Plain)), { left: said("left", 1), right: said("right", 2) })
show("assigned in order", describe(assignedInOrder()) + " " + order.join())
seen.length = 0
const assignedOverSetter = (a: number, b: number): Seen => Object.assign(Object.create(WithSetter), { b, a })
show("assigned over a setter", describe(assignedOverSetter(1, 2)) + " " + seen.join(";") + " " + addSeen(assignedOverSetter(3, 4)))
try {
  const assignedOverReadOnly = (): Seen => Object.assign(Object.create(ReadOnly), { b: 1, a: 2 })
  show("assigned over a read-only property", describe(assignedOverReadOnly()))
} catch (error) {
  show("assigned over a read-only property", (error as Error).constructor.name)
}
interface Named {
  readonly tag: string
  name: string
  greet(): string
}
const assignedMethod = (name: string): Named =>
  Object.assign(Object.create(Plain), {
    name,
    greet(this: Named) {
      return "hello " + this.name + " " + this.tag
    },
  })
show("assigned a method", describe(assignedMethod("n")) + " " + assignedMethod("m").greet() + " " + assignedMethod("m").greet.name)
const assignedSpread = (more: { left: number }): Pair => Object.assign(Object.create(Plain), { ...more, right: 9 })
show("assigned a spread", describe(assignedSpread({ left: 8 })))
const assignedTwice = (): Pair => Object.assign(Object.create(Plain), { left: 1 }, { right: 2, left: 3 })
show("assigned twice", describe(assignedTwice()))
const heldThenAssigned = (): Pair => {
  const self = Object.assign(Object.create(Plain), { left: 5, right: 6 })
  self.left++
  return self
}
show("held and then changed", describe(heldThenAssigned()))
let pairs = 0
for (let i = 0; i < 300; i++) pairs += assigned(i, 1).left + assignedOverSetter(i, 2).b
show("pairs", pairs)
const Swapped: object = {}
function overSwapped(a: number, b: number): Seen {
  const self = Object.create(Swapped)
  self.a = a
  self.b = b
  return self
}
for (let i = 0; i < 40; i++) overSwapped(i, i)
seen.length = 0
for (let round = 0; round < 3; round++) {
  Object.defineProperty(Swapped, "b", { set(value: number) { seen.push("b<-" + value) }, configurable: true })
  const through = overSwapped(1, round)
  delete (Swapped as any).b
  show("a setter that comes and goes " + round, describe(through) + " / " + describe(overSwapped(1, round)) + " " + seen.join())
}
const OnlyGetter: object = {
  get b() {
    return 7
  },
}
function overGetter(a: number, b: number): Seen {
  const self = Object.create(OnlyGetter)
  self.a = a
  self.b = b
  return self
}
try {
  show("a getter without a setter", describe(overGetter(1, 2)))
} catch (error) {
  show("a getter without a setter", (error as Error).constructor.name)
}
const Middle: object = {}
function overMiddle(a: number, b: number): Seen {
  const self = Object.create(Middle)
  self.a = a
  self.b = b
  return self
}
for (let i = 0; i < 40; i++) overMiddle(i, i)
seen.length = 0
Object.setPrototypeOf(Middle, WithSetter)
show("the prototype gets a prototype with a setter", describe(overMiddle(1, 2)) + " " + seen.join(";"))
Object.setPrototypeOf(Middle, Object.prototype)
show("and loses it again", describe(overMiddle(3, 4)) + " " + seen.join(";"))
Object.freeze(Middle)
show("a frozen prototype without the names", describe(overMiddle(5, 6)))
const Held: { a?: number } = { a: 1 }
function overHeld(a: number, b: number): Seen {
  const self = Object.create(Held)
  self.a = a
  self.b = b
  return self
}
for (let i = 0; i < 40; i++) overHeld(i, i)
show("the prototype holds the name", describe(overHeld(1, 2)))
Object.freeze(Held)
try {
  show("the prototype holds the name and is frozen", describe(overHeld(1, 2)))
} catch (error) {
  show("the prototype holds the name and is frozen", (error as Error).constructor.name)
}
interface Loose {
  readonly tag: string
  a?: number
  b: number
}
function makeAndDelete(a: number, b: number): Loose {
  const self = Object.create(Plain)
  self.a = a
  self.b = b
  delete self.a
  return self
}
show("a property is deleted again", describe(makeAndDelete(1, 2)) + " " + makeAndDelete(1, 2).a + " " + makeAndDelete(1, 2).tag)
function makeAndCount(b: number): Loose {
  const self = Object.create(Plain)
  self.b = b
  self.b++
  self.b += 2
  return self
}
show("a property is counted up", describe(makeAndCount(1)))
function makeByKeys(from: Record<string, number>): Loose {
  const self = Object.create(Plain)
  for (const key in from) self[key] = from[key]
  return self
}
show("keys that are not known", describe(makeByKeys({ b: 1, a: 2 })) + " " + makeByKeys({ b: 3 }).b)
function makeFromAnything(a: any, b: unknown): Loose {
  const self = Object.create(Plain)
  self.a = a
  self.b = b
  return self
}
show("values of no known type", describe(makeFromAnything(1, 2)) + " " + (makeFromAnything(3, 4).b + 1))
const MarkId = "~born/Mark"
interface Marked {
  readonly [MarkId]: typeof MarkId
  readonly tag: string
  size: number
}
function makeMarked(size: number): Marked {
  const self = Object.create(Plain)
  self[MarkId] = MarkId
  self.size = size
  return self
}
show("a key that is a constant string", describe(makeMarked(3)) + " " + makeMarked(4)[MarkId] + " " + makeMarked(5).size)
function makeByTypedKey(key: "size", size: number): Marked {
  const self = Object.create(Plain)
  self[MarkId] = MarkId
  self[key] = size
  return self
}
try {
  show("a key that only its type names", describe(makeByTypedKey("size", 6)) + " " + describe(makeByTypedKey("other" as any, 7)))
} catch (error) {
  show("a key that only its type names", (error as Error).constructor.name)
}
function attemptStore(store: () => unknown): string {
  try {
    store()
    return "stored"
  } catch (error) {
    return (error as Error).constructor.name
  }
}
const ShapeId = "~born/Shape"
interface Shape {
  readonly [ShapeId]: typeof ShapeId
  readonly kind: string
  readonly area: number
  side: number
  note?: string
  grown(by: number): number
}
const ShapeProto = {
  [ShapeId]: ShapeId,
  kind: "square",
  get area(): number {
    return (this as unknown as Shape).side * (this as unknown as Shape).side
  },
  grown(this: Shape, by: number) {
    return this.side + by
  },
}
function makeShape(side: number): Shape {
  const self = Object.create(ShapeProto)
  self.side = side
  return self
}
const isShape = (u: unknown): u is Shape => typeof u === "object" && u !== null && ShapeId in u
const shapes: Shape[] = []
for (let i = 0; i < 8; i++) shapes.push(makeShape(i))
const tell = (shape: Shape) => [isShape(shape), "kind" in shape, "note" in shape, shape.kind, shape.area, shape.grown(1), shape.note, Object.keys(shape).join()].join(" ")
let told = 0
for (let i = 0; i < 400; i++) told += tell(shapes[i & 7]!).length
show("what the prototype provides", tell(shapes[3]!) + " " + told)
const looseProto: any = ShapeProto
looseProto.kind = "box"
looseProto.note = "late"
show("the prototype is changed", tell(shapes[3]!) + " / " + tell(makeShape(2)))
delete looseProto.note
delete looseProto[ShapeId]
show("the prototype loses names", tell(shapes[3]!) + " / " + tell(makeShape(2)))
looseProto[ShapeId] = ShapeId
Object.defineProperty(looseProto, "kind", { get() { return "got " + this.side }, configurable: true })
Object.defineProperty(looseProto, "area", { value: -1, configurable: true, writable: true })
looseProto.grown = function (this: Shape, by: number) { return this.side - by }
show("a value becomes a getter and a getter a value", tell(shapes[3]!) + " / " + tell(makeShape(2)))
const looseShape: any = shapes[4]
show("a getter without a setter is stored to", attemptStore(() => (looseShape.kind = "own")) + " " + tell(shapes[4]!))
Object.defineProperty(looseShape, "kind", { value: "mine", enumerable: true, configurable: true, writable: true })
looseShape.area = 5
looseShape.grown = () => 0
looseShape.note = "n"
show("an object shadows its prototype", tell(shapes[4]!) + " / " + tell(shapes[5]!))
delete looseShape.kind
delete looseShape.area
delete looseShape.grown
delete looseShape.note
show("and stops shadowing it", tell(shapes[4]!))
Object.defineProperty(looseProto, "note", { set(this: Shape, value: string) { seen.push("note<-" + value + " on " + this.side) }, get() { return "through" }, configurable: true })
seen.length = 0
const noted = makeShape(6)
noted.note = "x"
shapes[1]!.note = "y"
show("an optional field meets an accessor that came late", tell(noted) + " / " + tell(shapes[1]!) + " " + seen.join())
delete looseProto.note
noted.note = "z"
show("and is a field again", tell(noted) + " / " + tell(shapes[1]!))
interface Tile {
  readonly kind: string
  readonly area: number
  side: number
  note?: string
  grown(by: number): number
}
const TileProto = {
  kind: "tile",
  get area(): number {
    return (this as unknown as Tile).side * 3
  },
  grown(this: Tile, by: number) {
    return this.side * by
  },
}
function makeTile(side: number): Tile {
  const self = Object.create(TileProto)
  self.side = side
  return self
}
const tellTile = (tile: Tile) => ["kind" in tile, "note" in tile, tile.kind, tile.area, tile.grown(2), tile.note, Object.keys(tile).join()].join(" ")
const givenTile: any = { side: 3, kind: "own plain", area: 1, note: "given" }
givenTile.grown = () => 9
const takenTile: Tile = givenTile
show("a plain object that holds what the prototype provides elsewhere", tellTile(takenTile) + " / " + tellTile(givenTile as Tile) + " / " + tellTile(makeTile(2)))
const tiles: Tile[] = [makeTile(7), takenTile]
let tilesTold = ""
for (let i = 0; i < 300; i++) tilesTold = tellTile(tiles[i & 1]!)
show("both through one place", tilesTold + " " + tiles.map((tile) => tile.kind + tile.area + tile.grown(2)).join())
interface Slab {
  readonly kind: string
  readonly area: number
  side: number
  note?: string
  grown(by: number): number
}
const SlabProto = {
  kind: "slab",
  get area(): number {
    return (this as unknown as Slab).side * 5
  },
  grown(this: Slab, by: number) {
    return this.side - by
  },
}
function makeSlab(side: number): Slab {
  const self = Object.create(SlabProto)
  self.side = side
  return self
}
const tellSlab = (slab: Slab) => ["kind" in slab, "note" in slab, slab.kind, slab.area, slab.grown(2), slab.note, Object.keys(slab).join()].join(" ")
const literalSlab: Slab = { kind: "literal", area: 2, side: 1, grown: (by: number) => by }
const slabs: Slab[] = [makeSlab(7), literalSlab]
let slabsTold = ""
for (let i = 0; i < 300; i++) slabsTold = tellSlab(slabs[i & 1]!)
show("a literal of the same type", tellSlab(literalSlab) + " / " + tellSlab(makeSlab(4)) + " / " + slabsTold + " " + slabs.map((slab) => slab.kind + slab.area + slab.grown(2)).join())
show("copies", [{ ...makeShape(8) }, { ...makeTile(8) }, { ...makeSlab(8) }, { ...literalSlab }, Object.assign({}, makeTile(9))].map((copy) => Object.keys(copy).join() + ":" + JSON.stringify(copy)).join(" / "))
interface Brick {
  readonly kind: string
  readonly area: number
  side: number
  grown(by: number): number
}
const BrickProto = {
  kind: "brick",
  get area(): number {
    return (this as unknown as Brick).side * 7
  },
  grown(this: Brick, by: number) {
    return this.side + 10 * by
  },
}
function makeBrick(side: number): Brick {
  const self = Object.create(BrickProto)
  self.side = side
  return self
}
const tellBrick = (brick: Brick) => ["kind" in brick, brick.kind, brick.area, brick.grown(2), Object.keys(brick).join()].join(" ")
const whole = { kind: "whole", area: 1, side: 2, grown: (by: number) => by }
const spreadBrick: Brick = { ...whole }
const spreadAndMore: Brick = { ...makeBrick(3), kind: "more", area: 5, grown: (by: number) => -by }
const assignedBrick: Brick = Object.assign(makeBrick(4), { kind: "assigned" })
let bricksTold = ""
for (const brick of [makeBrick(1), spreadBrick, spreadAndMore, assignedBrick]) bricksTold += tellBrick(brick) + " / "
show("spread into the type of what is born", bricksTold)
interface Labeled {
  readonly name: string
  readonly size: number
  weight: number
}
class LabeledThing implements Labeled {
  declare readonly name: string
  weight = 2
  get size() {
    return this.weight + 1
  }
}
;(LabeledThing.prototype as any).name = "thing"
class LabeledOwner implements Labeled {
  readonly name = "owner"
  readonly size = 9
  weight = 4
}
const LabeledProto = {
  name: "born",
  get size(): number {
    return (this as unknown as Labeled).weight + 5
  },
}
function makeLabeled(weight: number): Labeled {
  const self = Object.create(LabeledProto)
  self.weight = weight
  return self
}
const labeled: Labeled[] = [new LabeledThing(), makeLabeled(3), new LabeledOwner()]
let labeledTold = ""
for (let i = 0; i < 300; i++) {
  const one = labeled[i % 3]!
  labeledTold = i < 297 ? "" : labeledTold + [one.name, one.size, one.weight, "name" in one, Object.keys(one).join()].join(" ") + " / "
}
show("instances of classes and what is born, through one interface", labeledTold)
interface Stamped {
  readonly stamp: string
  weight: number
}
class StampedThing implements Stamped {
  declare readonly stamp: string
  weight = 2
}
;(StampedThing.prototype as any).stamp = "thing"
const StampedProto = { stamp: "born" }
function makeStamped(weight: number): Stamped {
  const self = Object.create(StampedProto)
  self.weight = weight
  return self
}
const stamped: Stamped[] = [new StampedThing(), makeStamped(3)]
let stampedTold = ""
for (let i = 0; i < 300; i++) {
  const one = stamped[i & 1]!
  stampedTold = i < 298 ? "" : stampedTold + [one.stamp, one.weight, "stamp" in one, Object.keys(one).join()].join(" ") + " / "
}
show("a class that only declares what its prototype holds, and what is born", stampedTold)
console.log(log.join("\n"))
