// Reflect.ownKeys, Object.getOwnPropertySymbols, Object.getOwnPropertyNames and Object.keys on objects of a type that has fields with symbol keys: the names come first and the symbols behind them, each in the order of creation, and the lists are arrays of their own. Once objects of one kind have been listed, listing more of them does not enter the run time.
// Env: JSC_aotCountsPath=/dev/null
const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0)
const kTag = Symbol("tag"), kLate = Symbol("late")
interface Tagged { n: number; [kTag]: string; s?: string; [kLate]?: number }
function show(value: object) { return Reflect.ownKeys(value).map(String).join() + " | " + Object.getOwnPropertySymbols(value).map(String).join() + " | " + Object.getOwnPropertyNames(value).join() + " | " + Object.keys(value).join() }
function sizes(tagged: Tagged) { return Reflect.ownKeys(tagged).length * 100 + Object.getOwnPropertySymbols(tagged).length * 10 + Object.keys(tagged).length }
let total = 0
for (let i = 0; i < 100; i++) total += sizes({ n: i, [kTag]: "t" }) + sizes({ [kTag]: "t", n: i, s: "s" })
const before = count("operationAOTOwnPropertyKeys")
for (let i = 0; i < 20000; i++) total += sizes({ n: i, [kTag]: "t" }) + sizes({ [kTag]: "t", n: i, s: "s" })
console.log(total, count("operationAOTOwnPropertyKeys") - before < 100)
const a: Tagged = { n: 1, [kTag]: "t" }
console.log(show(a))
a[kLate] = 2
console.log(show(a))
a.s = "late"
console.log(show(a))
const b: Tagged = { [kLate]: 1, s: "s", [kTag]: "t", n: 2 }
console.log(show(b), Reflect.ownKeys(b)[2] === kLate, Object.getOwnPropertySymbols(b)[1] === kTag)
delete b[kLate]
console.log(show(b))
const list = Reflect.ownKeys(a); list.push("pushed"); list[0] = "changed"
console.log(list.map(String).join(), show(a))
const symbols = Object.getOwnPropertySymbols({ x: 1 }); symbols.push(kTag)
console.log(symbols.length, Object.getOwnPropertySymbols({ x: 1 }).length, Array.isArray(symbols))
Object.freeze(a)
console.log(show(a), Object.isFrozen(a))
Object.defineProperty(b, kTag, { enumerable: false })
console.log(show(b), JSON.stringify({ ...b }), Object.getOwnPropertySymbols({ ...b }).length)
