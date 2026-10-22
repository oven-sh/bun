// The same change of prototype, made again and again, is carried out by compiled code alone. A read that goes past the object afterwards finds what the new prototype has:
// behind Object.setPrototypeOf and Reflect.setPrototypeOf, called by name and through a variable, behind __proto__ in a literal, and behind a construction with another new.target or by another closure of a constructor function.
declare const console: { log(...args: unknown[]): void }
class Point {
  x: number
  declare label?: string
  constructor(x: number) {
    this.x = x
  }
}
const named = { label: "from the other prototype", extra: 7 }
function labelOf(point: Point): string | undefined {
  return point.label
}
function extraOf(value: { extra?: number }): number | undefined {
  return value.extra
}

const lines: string[] = []
for (let i = 0; i < 6; ++i) {
  const point = new Point(i)
  const before = labelOf(point)
  Object.setPrototypeOf(point, named)
  lines.push("Object.setPrototypeOf " + i + ": " + before + " -> " + labelOf(point) + ", " + extraOf(point as { extra?: number }) + ", " + (point instanceof Point))
}
for (let i = 0; i < 6; ++i) {
  const point = new Point(i)
  const changed = Reflect.setPrototypeOf(point, named)
  lines.push("Reflect.setPrototypeOf " + i + ": " + changed + " " + labelOf(point))
}
const throughVariable: (object: object, prototype: object | null) => object = [Object.setPrototypeOf][lines.length & 0]
for (let i = 0; i < 6; ++i) {
  const point = new Point(i)
  throughVariable(point, named)
  lines.push("through a variable " + i + ": " + labelOf(point))
}
for (let i = 0; i < 6; ++i) {
  const record: { a: number; label?: string; extra?: number } = { __proto__: named, a: i } as { a: number }
  lines.push("__proto__ in a literal " + i + ": " + record.label + ", " + extraOf(record) + ", " + Object.keys(record).join())
}
class Other {}
;(Other.prototype as { label?: string }).label = "from the prototype of new.target"
for (let i = 0; i < 6; ++i) {
  const point = Reflect.construct(Point, [i], i & 1 ? Other : Point) as Point
  lines.push("another new.target " + i + ": " + labelOf(point) + ", " + (point instanceof Point) + ", " + (point instanceof Other))
}
function makeConstructor(text: string) {
  function Made(this: { a: number; label?: string }, a: number) {
    this.a = a
  }
  Made.prototype.label = text
  return Made as unknown as new (a: number) => { a: number; label?: string }
}
for (let i = 0; i < 6; ++i) {
  const Made = makeConstructor("closure " + (i % 3))
  const first = new Made(i)
  const second = new Made(i + 1)
  lines.push("a closure of a constructor function " + i + ": " + first.label + ", " + second.label + ", " + (Object.getPrototypeOf(first) === Object.getPrototypeOf(second)))
}
for (let i = 0; i < 4; ++i) {
  const point = new Point(i)
  Object.setPrototypeOf(point, named)
  Object.setPrototypeOf(point, Point.prototype)
  lines.push("and back " + i + ": " + labelOf(point) + ", " + (point instanceof Point))
}
console.log(lines.join("\n"))
