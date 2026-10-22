// Object.getOwnPropertyNames and Reflect.ownKeys list the non-enumerable and symbol-keyed properties added to a typed object, Object.keys does not, every result is a fresh array, and Object.assign from an object with an own enumerable __proto__ sets the target's prototype.
class Point { x: number = 1; y: number = 2 }
class PointWithProtoField { x: number = 1; ["__proto__"]: object = { inherited: 1 } }
interface Spot { x: number; y: number }

const makers: [string, () => any][] = [
  ["instance", () => new Point()],
  ["literal", (): Spot => ({ x: 1, y: 2 })],
  ["instance with a __proto__ field", () => new PointWithProtoField()],
  ["frozen instance", () => Object.freeze(new Point())],
  ["sealed instance", () => Object.seal(new Point())],
  ["non-extensible instance", () => Object.preventExtensions(new Point())],
]

const steps: [string, (o: any) => void][] = [
  ["unchanged", () => {}],
  ["add extra", o => { o.extra = 3 }],
  ["define hidden", o => { Object.defineProperty(o, "hidden", { value: 4, enumerable: false, writable: true, configurable: true }) }],
  ["add symbol", o => { o[Symbol.for("s")] = 5 }],
  ["delete x", o => { delete o.x }],
  ["assign x and z", o => { Object.assign(o, { x: 9, z: 1 }) }],
  ["define hidden __proto__", o => { Object.defineProperty(o, "__proto__", { value: { inherited: 1 }, enumerable: false, writable: true, configurable: true }) }],
  ["define enumerable __proto__", o => { Object.defineProperty(o, "__proto__", { enumerable: true }) }],
  ["freeze", o => { Object.freeze(o) }],
]

const listings: [string, (o: any) => PropertyKey[]][] = [
  ["keys", o => Object.keys(o)],
  ["getOwnPropertyNames", o => Object.getOwnPropertyNames(o)],
  ["ownKeys", o => Reflect.ownKeys(o)],
]

const probedNames = ["x", "extra", "hidden", "absent"]

function show(o: any): string {
  return [
    Object.keys(o),
    Object.getOwnPropertyNames(o),
    Reflect.ownKeys(o).map(String),
    Object.values(o),
    JSON.stringify(Object.entries(o)),
    Reflect.ownKeys(Object.assign({}, o)).map(String),
    Object.getPrototypeOf(Object.assign({}, o)) === Object.prototype,
    Object.isFrozen(o),
    Object.isSealed(o),
    Object.isExtensible(o),
    ...probedNames.flatMap(name => [Object.hasOwn(o, name), Object.prototype.hasOwnProperty.call(o, name)]),
  ].join("|")
}

function applyStep(o: any, apply: (o: any) => void): string {
  try {
    apply(o)
    return "done"
  } catch (e) {
    return "threw " + (e as Error).name
  }
}

function writeToListing(o: any, list: (o: any) => PropertyKey[]): string {
  const k = list(o)
  k.push("q")
  k[0] = "r"
  return k.map(String).join()
}

for (const [label, make] of makers) {
  const o = make()
  for (const [step, apply] of steps) {
    console.log(label + ", " + step + ": " + applyStep(o, apply))
    console.log(show(o))
    for (const [listing, list] of listings) console.log(listing + " after writes: " + writeToListing(o, list))
    console.log(show(o))
  }
}

export {}
