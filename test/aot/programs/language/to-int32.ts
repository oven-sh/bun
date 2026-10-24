// Conversion of doubles to 32-bit integers, as ECMAScript's ToInt32 specifies.
const texts = ["NaN", "Infinity", "-Infinity", "0", "-0", "1.5", "-1.5", "0.9999999999999999", "-0.5", "5e-324", "2147483647", "2147483648", "-2147483648", "-2147483649", "-2147483647", "-2147483646", "-2147483645", "-2147483644",
  "4294967295", "4294967296", "4294967301", "4294967295.9", "-4294967297", "9007199254740991", "9007199254740992", "-9007199254740993", "1e21", "-1e21", "1.7976931348623157e308", "123", "-123", "65536.25"]
const values: number[] = texts.map(Number)
const bits = (x: number) => [x | 0, x & 7, ~x, x >> 1, x >>> 0, x << 1, x ^ 1, x >>> 31].join()
for (let i = 0; i < values.length; i++) console.log(texts[i], bits(values[i]))
class Kept { o: number[] = []; count: number; other?: number; constructor(count: number) { this.count = count } }
const show = (x: number | undefined) => x === undefined ? "undefined" : Object.is(x, -0) ? "-0" : String(x)
const kept = new Kept(1)
for (let i = 0; i < 4; i++) kept.count += i
const line: string[] = []
for (const x of values) { kept.count = x; kept.other = x; line.push(show(kept.count) + "/" + show(kept.other) + "/" + show((kept as any).count) + "/" + (kept.count === x || x !== x)) }
console.log(line.join(" "))
kept.count = 2147483646
const steps: string[] = []
for (let i = 0; i < 4; i++) { kept.count++; steps.push(show(kept.count)) }
kept.count = -2147483642
for (let i = 0; i < 8; i++) { kept.count--; steps.push(show(kept.count)) }
kept.count = 0; kept.count *= -1; steps.push(show(kept.count)); kept.count += 0; steps.push(show(kept.count))
console.log(steps.join(" "))
const loose: unknown[] = values.map(x => x)
console.log(loose.map(x => show(x as number)).join(" "))
