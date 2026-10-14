// Static members, enums and namespaces in everyday use, and default exports of expressions.
class Registry {
  static count = 0
  static readonly names: string[] = []
  static #secret = 41
  static add(name: string): number { Registry.names.push(name); return ++Registry.count }
  static get last(): string { return Registry.names[Registry.names.length - 1] ?? "none" }
  static set last(v: string) { Registry.names[Registry.names.length - 1] = v }
  static reveal(): number { return Registry.#secret + 1 }
  static { Registry.count = 10; Registry.names.push("first") }
}
class Sub extends Registry { static extra = Registry.count * 2; static twice(name: string): number { return Sub.add(name) + Sub.add(name) } }
console.log(Registry.count, Registry.last, Registry.add("a"), Sub.twice("b"), Registry.count, Sub.count, Sub.extra, Registry.reveal())
Registry.last = "z"
Registry.count += 5
Registry.count ||= 1
console.log(Registry.names.join(), Registry.count, [1, 2].map(Registry.reveal).join())

enum Color { Red, Green = 5, Blue, Name = "name" }
const enum Fast { A = 1, B = A << 3 }
function nameOf(c: Exclude<Color, Color.Name>): string { return Color[c] ?? "?" }
console.log(Color.Red, Color.Blue, Color.Name, nameOf(Color.Green), nameOf(6), Object.keys(Color).join(), Fast.B, Color === Color)

namespace Geometry {
  export const unit = 2
  const hidden = 3
  export let calls = 0
  export function scale(n: number): number { calls++; return n * unit * hidden }
  export namespace Deep { export const depth = unit + 1; export function twice(n: number): number { return scale(n) * 2 } }
}
console.log(Geometry.unit, Geometry.scale(1), Geometry.Deep.depth, Geometry.Deep.twice(2), Geometry.calls)
Geometry.calls = 100
console.log(Geometry.scale(0), Geometry.calls)
