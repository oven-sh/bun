// Objects with layouts seen through the built-ins that walk, test and copy their properties, with and without added properties.
// COUNTER: RedefinedProperty >= 1
const tag = Symbol("tag")
const addedSymbol = Symbol("added")
const missingSymbol = Symbol("missing")
const rounds = 2000

interface Point { x: number; y: string; z?: number }
interface Pair { a: number; b: string }
interface Empty { }
interface Maybe { value: number; then?: () => void }
interface Printable { value: number; toJSON?: () => string }

class Item {
  id = 1;
  #secret = 2;
  [tag] = "tagged"
  label = "item"
  stored = function (): string { return "stored" }
  secret(): number { return this.#secret }
}
class Later { a = 1 }
class LaterJSON { a = 1 }
class Reparented { a = 1 }
class ReparentedJSON { a = 1 }

function shown(value: unknown): string {
  if (typeof value === "function") return "function"
  if (typeof value === "symbol") return String(value)
  return String(JSON.stringify(value))
}
function descriptorText(o: object): string {
  const all: any = Object.getOwnPropertyDescriptors(o)
  return Reflect.ownKeys(all).map(key => {
    const d = all[key]
    return String(key) + ":" + shown(d.value) + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "")
  }).join()
}
function presenceText(o: object): string {
  return [...Reflect.ownKeys(o), "missing", missingSymbol].map(key => String(key) + ":" + o.hasOwnProperty(key) + Object.hasOwn(o, key) + o.propertyIsEnumerable(key)).join()
}
function assignText(o: object): string {
  try {
    Object.assign(o, { x: 9, more: 10 })
    return Reflect.ownKeys(o).map(String).join()
  } catch (e) {
    return "threw " + (e as Error).name
  }
}

const reads: [string, (o: object) => string][] = [
  ["entries", o => Object.entries(o).map(([key, value]) => key + "=" + shown(value)).join()],
  ["values", o => Object.values(o).map(shown).join()],
  ["keys", o => Object.keys(o).join()],
  ["names", o => Object.getOwnPropertyNames(o).join()],
  ["symbols", o => Object.getOwnPropertySymbols(o).map(String).join()],
  ["descriptors", descriptorText],
  ["ownKeys", o => Reflect.ownKeys(o).map(String).join()],
  ["presence", presenceText],
  ["integrity", o => [Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o)].join()],
  ["json", o => JSON.stringify(o)],
  ["copy", o => Reflect.ownKeys(Object.assign({}, o)).map(String).join()],
  ["assign", assignText],
]

function variants(make: () => object): [string, () => object][] {
  const withAdded = (add: (o: any) => void) => () => { const o = make(); add(o); return o }
  return [
    ["plain", make],
    ["added string", withAdded(o => { o.added = "s" })],
    ["added symbol", withAdded(o => { o[addedSymbol] = "s" })],
    ["added hidden", withAdded(o => { Object.defineProperty(o, "hidden", { value: 1, enumerable: false, writable: true, configurable: true }) })],
    ["added read-only", withAdded(o => { Object.defineProperty(o, "fixed", { value: 2, enumerable: true, writable: false, configurable: true }) })],
    ["frozen", () => Object.freeze(make())],
    ["frozen with added", withAdded(o => { o.added = "s"; Object.freeze(o) })],
    ["sealed", () => Object.seal(make())],
    ["sealed with added", withAdded(o => { o.added = "s"; Object.seal(o) })],
    ["non-extensible", () => Object.preventExtensions(make())],
  ]
}

async function checkEveryVariant(label: string, make: () => object): Promise<void> {
  for (const [variant, create] of variants(make)) {
    for (const [read, text] of reads) {
      const first = text(create())
      let isStable = true
      for (let i = 0; i < rounds; i++) isStable &&= text(create()) === first
      console.log(label, variant, read, isStable, first)
    }
    let settledToSelf = 0
    for (let i = 0; i < rounds; i++) {
      const o = create()
      if (await o === o && await Promise.resolve(o) === o) settledToSelf++
    }
    console.log(label, variant, "await", settledToSelf)
  }
}

function checkAddedGetter(): void {
  let calls = 0
  const make = (): Point => {
    const o: Point = { x: 1, y: "y" }
    Object.defineProperty(o, "computed", { get() { calls++; return calls }, enumerable: true, configurable: true })
    return o
  }
  for (const [read, walk] of [["values", Object.values], ["entries", Object.entries], ["copy", (o: object) => Object.assign({}, o)], ["json", JSON.stringify]] as [string, (o: object) => unknown][]) {
    calls = 0
    walk(make())
    console.log("getter", read, calls)
  }
  console.log("getter keys", Object.keys(make()).join(), descriptorText(make()))
}

function checkAddedIndex(): void {
  const o: Point = { x: 1, y: "y" };
  (o as any)[0] = "zero"
  for (const [read, text] of reads) console.log("index", read, text(o))
}

async function settle(value: unknown): Promise<unknown> {
  return await value
}

async function checkThen(): Promise<void> {
  const first: Maybe = { value: 1 }
  const sibling: Maybe = { value: 2 }
  for (let i = 0; i < rounds; i++) await settle(first)
  console.log("then absent", await settle(first) === first);
  (first as any).then = (resolve: (value: number) => void) => resolve(7)
  console.log("then set", await settle(first), await settle(sibling) === sibling, await Promise.resolve(first as unknown))

  const early = new Later()
  for (let i = 0; i < rounds; i++) await settle(early)
  console.log("prototype then absent", await settle(early) === early);
  (Later.prototype as any).then = (resolve: (value: number) => void) => resolve(8)
  console.log("prototype then added", await settle(early), await settle(new Later()))

  const reparented = new Reparented()
  for (let i = 0; i < rounds; i++) await settle(reparented)
  console.log("inherited then absent", await settle(reparented) === reparented)
  Object.setPrototypeOf(Reparented.prototype, { then(resolve: (value: number) => void) { resolve(9) } })
  console.log("inherited then after setPrototypeOf", await settle(reparented), await settle(new Reparented()))
}

function checkToJSON(): void {
  const first: Printable = { value: 1 }
  const sibling: Printable = { value: 2 }
  for (let i = 0; i < rounds; i++) JSON.stringify(first);
  (first as any).toJSON = () => "custom"
  console.log("toJSON set", JSON.stringify(first), JSON.stringify(sibling))

  const early = new LaterJSON()
  for (let i = 0; i < rounds; i++) JSON.stringify(early)
  console.log("prototype toJSON absent", JSON.stringify(early));
  (LaterJSON.prototype as any).toJSON = () => "from prototype"
  console.log("prototype toJSON added", JSON.stringify(early), JSON.stringify(new LaterJSON()))

  const reparented = new ReparentedJSON()
  for (let i = 0; i < rounds; i++) JSON.stringify(reparented)
  console.log("inherited toJSON absent", JSON.stringify(reparented))
  Object.setPrototypeOf(ReparentedJSON.prototype, { toJSON() { return "from new parent" } })
  console.log("inherited toJSON after setPrototypeOf", JSON.stringify(reparented), JSON.stringify(new ReparentedJSON()))
}

function checkEmptyNonExtensible(): void {
  const empty: Empty = {}
  Object.preventExtensions(empty)
  console.log("empty non-extensible", Object.isFrozen(empty), Object.isSealed(empty), Object.isExtensible(empty))
}

function checkRedefinition(): void {
  const o: Pair = { a: 1, b: "b" }
  Object.defineProperty(o, "a", { enumerable: false })
  for (const [read, text] of reads) console.log("redefined", read, text(o))
  console.log("redefined read", o.a, o.b)
}

async function main(): Promise<void> {
  await checkEveryVariant("literal", (): Point => ({ x: 1, y: "y" }))
  await checkEveryVariant("instance", () => new Item())
  console.log("private", new Item().secret())
  checkAddedGetter()
  checkAddedIndex()
  await checkThen()
  checkToJSON()
  checkEmptyNonExtensible()
  checkRedefinition()
}

main()
