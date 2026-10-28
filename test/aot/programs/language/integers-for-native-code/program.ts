declare function describe(value: unknown): string
const kind = (value: unknown) => describe(value).split(":")[0]
class Holder { k: number; opt?: number; wide: number | string; constructor(k: number) { this.k = k; this.wide = k } }
const holder: { k: number } = { k: 1 << 1 }
const read = (h: { k: number }) => kind(h.k)
console.log("c-once's:", read(holder), kind(4 / 2))
const n = Number("7"), half = Number("2.5")
const twice = (x: number): number => x * 2
let variable: number = n / 7
const captured = () => kind(variable)
console.log("computed:", kind(half * 2), kind(Math.floor(half)), kind(half | 0), kind(n / 7), kind(n - 0.5 + 0.5), kind(twice(half)), kind(Math.sqrt(49)), kind(n % 4), kind(2 ** 3), kind(-n))
const made = new Holder(n / 7)
made.opt = half * 4
console.log("fields:", kind(made.k), kind(made.opt), kind(made.wide), kind((made as any).k), kind((made as any).opt))
const list: number[] = [n / 7, half * 2, 3]
const loose: any = list
const seen: string[] = []
for (const x of loose) seen.push(kind(x))
console.log("elements:", kind(list[0]), kind(list[1]), kind(loose[0]), kind(loose[1]), seen.join(), list.map(x => kind(x)).join())
console.log("places:", captured(), kind(variable), ((...rest: unknown[]) => rest.map(kind).join())(n / 7, half * 2), kind([n / 7][0]), kind({ p: half * 2 }.p))
console.log("the ends:", kind(-2147483648 + n - n), kind(2147483647 + n - n), kind(n * 0))
console.log("no int32:", kind(half), kind(-(n * 0)), kind(n / 0), kind(0 / (n * 0)), kind(2147483648 + n - n), kind(-2147483649 + n - n), kind(made.k / 2))
