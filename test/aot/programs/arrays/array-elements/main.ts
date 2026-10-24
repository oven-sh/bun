// An array literal's storage is chosen from its expected element type; later stores of other kinds of values still behave like any JavaScript array.
import { mixed, integers, fractions, empty, grown, pushed, handedOn } from "./untyped/arrays.js"
const enum Small { Zero, One, Two }
const show = (name: string, list: unknown[]) => console.log(name + ": " + list.length + " " + list.map(v => typeof v + (Object.is(v, -0) ? "-0" : String(v))).join())
const numbers: number[] = [3, 1, 4]
numbers.push(1.5); numbers[6] = -0; show("numbers", numbers)
const none: number[] = []
none.push(1); none.push(0.5); none.unshift(NaN); show("none", none)
const small: Small[] = [Small.One, Small.Two]
small.push(Small.Zero); (small as number[]).push(2.5); (small as unknown[]).push("s"); show("small", small)
const digits: (0 | 1 | 2)[] = [0, 1, 2]
digits.reverse(); (digits as any).push(4294967296, undefined, {}); show("digits", digits.slice(0, 5))
function pair(x: number, y: number) { return [x, y] }
show("pair", pair(1, 2)); show("pair", pair(0.1, -0)); show("pair", pair(2 ** 31, -(2 ** 31) - 1))
const inferred = [1, 2, 3]
inferred[1] = 2.5; show("inferred", inferred)
const asserted = [] as number[]
asserted[2] = 7; show("asserted", asserted)
const spread: number[] = [0, ...numbers, 9]
show("spread", spread)
function around(r: number[], x: number): number[] { return [x, ...r, x] }
function both(r: number[], q: Iterable<number>): number[] { return [...r, ...q] }
show("around", around([1.5, 2], 7)); show("both", both([1], new Set([2, 2.5]))); show("both", both([], []))
const holes: (number | undefined)[] = [1, , 3]
show("holes", holes)
const either: (number | string)[] = [1, 2]
either.push("s"); show("either", either)
const optional: number[] | undefined = [1, 2]
optional.push(3.5); show("optional", optional)
const nested: number[][] = [[1, 2], [], [0.5]]
nested[1].push(1e300); show("nested", nested.flat())
const evolving = []
for (let i = 0; i < 3; i++) evolving.push(i * 2)
evolving.push(0.5); show("evolving", evolving)
const byIndex = []
byIndex[0] = 1; byIndex[2] = 3; show("byIndex", byIndex)
const texts = []
texts.push("a"); texts.push(1); show("texts", texts)
const untyped: any = [1, 2, 3]
untyped.push("s", 1.5); show("untyped", untyped)
show("mixed", mixed()); show("integers", integers()); show("fractions", fractions()); show("empty", empty()); show("grown", grown()); show("pushed", pushed()); show("handedOn", handedOn())
const keys: string[] = []
for (const key in { a: 1, b: 2, 3: 3 }) keys.push(key)
for (const key in [7, 8]) keys.push(key)
for (const key in "xy" as any) keys.push(key)
show("keys", keys)
