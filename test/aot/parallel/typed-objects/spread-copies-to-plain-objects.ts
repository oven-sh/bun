// The spread of a typed object whose keys are in an expected order is copied field by field into a plain object. Every other source takes the generic path, and both give what plain Bun gives.
type Point = { x: number; y: number }
type Named = { name: string; tag?: string; point: Point }

class Vector {
  x: number
  y: number
  #secret = 7
  constructor(x: number, y: number) {
    this.x = x
    this.y = y
  }
  get length(): number {
    return Math.hypot(this.x, this.y)
  }
  secret(): number {
    return this.#secret
  }
}

function describe(label: string, copy: object): void {
  console.log(label, JSON.stringify(copy), Object.keys(copy).join(","), Object.getPrototypeOf(copy) === Object.prototype, Object.isFrozen(copy), Object.isExtensible(copy))
}

function copyPoint(point: Point): object {
  return { ...point }
}

function copyPointWithStores(point: Point, y: number, z: number): object {
  return { ...point, y, z }
}

function copyPointAfterStores(point: Point, v: number, w: number): object {
  return { v, w, ...point }
}

function copyNamed(named: Named): object {
  return { ...named, tag: "copied" }
}

function copyVector(vector: Vector): object {
  return { ...vector }
}

function copyVectorWithStore(vector: Vector, length: number): object {
  return { ...vector, length }
}

function copyNullable(point: Point | null | undefined): object {
  return { ...point }
}

const points: Point[] = []
for (let i = 0; i < 4; i++) points.push({ x: i, y: -i })
for (const point of points) {
  describe("point", copyPoint(point))
  describe("stores", copyPointWithStores(point, 10, 20))
  describe("stores first", copyPointAfterStores(point, 30, 40))
  describe("nullable", copyNullable(point))
}
describe("null", copyNullable(null))
describe("undefined", copyNullable(undefined))

const copy = copyPoint(points[1]) as Point
copy.x = 100
console.log(points[1].x, copy.x)
describe("copy of a copy", copyPoint(copy))

describe("named", copyNamed({ name: "a", point: points[0] }))
describe("named with tag", copyNamed({ name: "b", tag: "t", point: points[1] }))
describe("named in another order", copyNamed({ point: points[2], tag: "u", name: "c" }))
const shared = copyNamed({ name: "d", point: points[3] }) as Named
console.log(shared.point === points[3])

const vector = new Vector(3, 4)
describe("vector", copyVector(vector))
describe("vector with store", copyVectorWithStore(vector, -1))
console.log("length" in copyVector(vector), copyVector(vector) instanceof Vector, vector.secret())

describe("frozen", copyPoint(Object.freeze({ x: 1, y: 2 })))
describe("sealed", copyPoint(Object.seal({ x: 3, y: 4 })))
describe("not extensible", copyPoint(Object.preventExtensions({ x: 5, y: 6 })))

const extended: Point = { x: 7, y: 8 }
;(extended as any).z = 9
;(extended as any)[Symbol.for("s")] = 10
const extendedCopy = copyPoint(extended)
describe("extended", extendedCopy)
console.log((extendedCopy as any)[Symbol.for("s")])

const shortened: Point = { x: 11, y: 12 }
delete (shortened as any).x
describe("shortened", copyPoint(shortened))
;(shortened as any).x = 13
describe("restored in another order", copyPoint(shortened))

const hidden: Point = { x: 14, y: 15 }
Object.defineProperty(hidden, "x", { enumerable: false })
describe("hidden", copyPoint(hidden))

let reads = 0
const computed: Point = { x: 16, y: 17 }
Object.defineProperty(computed, "y", { get() { return ++reads }, enumerable: true })
describe("computed", copyPoint(computed))
describe("computed", copyPoint(computed))
console.log(reads)

describe("from outside", copyPoint(JSON.parse('{"y":1,"x":2,"extra":3}')))
