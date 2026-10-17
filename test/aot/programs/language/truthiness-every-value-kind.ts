// Every kind of value asked whether it is truthy, through types that say nothing, in every place the language asks.
const values: [string, unknown][] = [
  ["undefined", undefined], ["null", null], ["true", true], ["false", false],
  ["0", 0], ["-0", -0], ["1", 1], ["-1", -1], ["2 ** 31", 2 ** 31], ["-(2 ** 31)", -(2 ** 31)], ["0.5", 0.5], ["-0.5", -0.5], ["NaN", NaN], ["Infinity", Infinity], ["-Infinity", -Infinity], ["5e-324", 5e-324], ["2 ** 53", 2 ** 53],
  ["empty string", ""], ["space", " "], ["'0'", "0"], ["'false'", "false"],
  ["0n", 0n], ["1n", 1n], ["-1n", -1n], ["2n ** 70n", 2n ** 70n],
  ["symbol", Symbol("s")], ["object", {}], ["array", []], ["function", () => false], ["class", class {}], ["date", new Date(0)], ["regexp", /x/], ["map", new Map()], ["boxed false", new Boolean(false)], ["boxed 0", new Number(0)], ["boxed empty", new String("")], ["null prototype", Object.create(null)], ["proxy", new Proxy({}, {})],
]
function asCondition(value: unknown): boolean { if (value) return true; return false }
function asNot(value: unknown): boolean { return !value }
function asTernary(value: any): string { return value ? "t" : "f" }
function asAnd(value: any): unknown { return value && "went on" }
function asOr(value: any): unknown { return value || "went on" }
function asLoop(value: unknown): number { let turns = 0; while (value) { turns++; value = undefined } return turns }
function asBoolean(value: unknown): boolean { return Boolean(value) }
function asDoubleNot(value: unknown): boolean { return !!value }
for (const [name, value] of values) {
  const and = asAnd(value), or = asOr(value)
  console.log(name, asCondition(value), asNot(value), asTernary(value), and === value ? "itself" : String(and), or === value ? "itself" : String(or), asLoop(value), asBoolean(value), asDoubleNot(value), [value].filter(Boolean).length, [value].some(each => each), [value].find(each => !each) === value)
}
// Strings that are put together at run time and not yet made flat.
const parts = ["", "a", "bc", "", "def"]
function joined(a: string, b: string): unknown { return a + b }
function part(text: string, from: number, to: number): unknown { return text.substring(from, to) }
const answers: string[] = []
for (const a of parts) for (const b of parts) answers.push(asTernary(joined(a, b)) + (asCondition(joined(a + "x".repeat(a.length * 20), b)) ? 1 : 0))
console.log(answers.join(" "))
const long = "the quick brown fox jumps over the lazy dog, twice over and once more"
console.log([[0, 0], [0, 1], [5, 5], [5, 40], [68, 69], [69, 69], [70, 90]].map(([from, to]) => asTernary(part(long, from, to))).join(""))
// The same sites, many times, with the kinds by turns.
let truthy = 0
for (let i = 0; i < 200000; i++) if (asCondition(values[i % values.length][1])) truthy++
console.log(truthy)
interface Node { next?: Node; flag?: boolean; count?: number; name?: string }
function walk(node: Node | undefined): number { let seen = 0; while (node) { if (node.flag) seen += 1; if (node.count) seen += 10; if (node.name) seen += 100; node = node.next } return seen }
let list: Node | undefined
for (let i = 0; i < 1000; i++) list = { next: list, flag: i % 2 ? true : i % 3 ? false : undefined, count: i % 5 ? i % 4 : undefined, name: i % 7 ? (i % 2 ? "" : "n") : undefined }
console.log(walk(list))
