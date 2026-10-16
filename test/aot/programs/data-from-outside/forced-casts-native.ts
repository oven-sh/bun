// A double cast of a built-in object (a Map) to an interface type.
interface Closed { only: number; o: number[] }
const map: Closed = new Map<string, number>([["only", 1]]) as unknown as Closed
console.log("types without a layout:", map.o, (map as unknown) instanceof Map, (map as unknown as Map<string, number>).get("only"))
interface Open { only?: number; o?: number[] }
const open: Open = new Map<string, number>([["only", 1]]) as unknown as Open
console.log("nothing is required:", open.o, open.only, (open as unknown) instanceof Map)
function fill<T extends object>(): T { const d: Record<string, unknown> = { only: 1 }; return d as T }
interface First { only: number; o?: number[] }
const first: First = fill<First>()
interface Second { other: string; only: number }
const second: Second = first as unknown as Second
console.log("a stranger forced twice:", second.only, second.other, (second as unknown) === first)
