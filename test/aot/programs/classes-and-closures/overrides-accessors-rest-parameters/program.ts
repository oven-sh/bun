abstract class Shape {
  constructor(public name: string) {}
  abstract area(): number
  describe(): string { return this.name + ":" + this.area().toFixed(2) }
  get label(): string { return "<" + this.name + ">" }
}
class Circle extends Shape { constructor(public r: number) { super("circle") } area(): number { return Math.PI * this.r * this.r } }
class Square extends Shape { constructor(public s: number) { super("square") } area(): number { return this.s * this.s } get label(): string { return "[" + this.name + "]" } }
class Cube extends Square { area(): number { return 6 * this.s * this.s } describe(): string { return "cube!" + this.area() } }
const shapes: Shape[] = [new Circle(1), new Square(2), new Cube(3), new Circle(0.5)]
let total = 0
for (const shape of shapes) total += shape.area()
console.log(total.toFixed(3), shapes.map(s => s.describe()).join(" "), shapes.map(s => s.label).join(""))

class Temperature {
  private kelvin = 0
  get celsius(): number { return this.kelvin - 273.15 }
  set celsius(v: number) { this.kelvin = v + 273.15 }
}
class Clamped extends Temperature { set celsius(v: number) { super.celsius = Math.max(v, -273.15) } get celsius(): number { return super.celsius } }
const t = new Temperature()
t.celsius = 26.85
t.celsius += 1
console.log(t.celsius.toFixed(2))

class Logger {
  lines: string[] = []
  log(level: string, ...parts: (string | number)[]): number { this.lines.push(level + ":" + parts.join("|")); return parts.length }
}
class Loud extends Logger { log(level: string, ...parts: (string | number)[]): number { return super.log(level.toUpperCase(), ...parts, "!") } }
const plain = new Logger()
console.log(plain.log("a"), plain.log("b", 1), plain.log("c", 1, "two", 3), plain.lines.join(" "))
const collect = (first: number, ...rest: number[]) => first * 100 + rest.length * 10 + (rest[1] ?? 0)
const pick = [collect, (a: number, ...r: number[]) => a + r.length]
console.log(collect(1), collect(1, 2), collect(1, 2, 3, 4), pick[0]!(1, 2, 3), pick[1]!(1, 2, 3), pick.map(f => f(5, 6)).join())
function many(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number { return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 }
const indirect: any = many
console.log(many(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), indirect(1, 2, 3, 4, 5, 6, 7, 8, 9, 10))
