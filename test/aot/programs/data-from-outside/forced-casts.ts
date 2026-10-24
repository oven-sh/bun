// A double cast (`x as unknown as T`, `<T><any>x`) of an object to an object type passes: any object fits, it stays the same object, and a member it does not have reads undefined.
interface Tool { name: string; run(): string; level: number }
interface Part { level: number; o: number[] }
const part: Part = { level: 3, o: [1] }
const tool: Tool = part as unknown as Tool
console.log("record:", tool.level, tool.name, typeof tool.run, (tool as unknown) === part)
const again: Tool = <Tool><any>part
console.log("angle brackets:", again.level, (again as unknown) === part)
const given: Tool = Object.assign(part, { extra: 1 }) as unknown as Tool
console.log("what hands back its argument:", given.level, (given as unknown) === part)
class Service { n = 1; get() { return this.n } }
const fake = { n: 2, get() { return 5 }, o: [1] }
const held: Service = fake as unknown as Service
console.log("a class:", held.get(), held.n, held instanceof Service)
function build<D extends { level: number }>(def: D): D & Tool { const made = { level: def.level + 1, o: [2] }; return made as unknown as D & Tool }
const built = build({ level: 1, more: "m" })
console.log("out of generic code:", built.level, built.name, built.more)
const list: Tool[] = [tool, again]
console.log("in an array:", list.map(t => t.level).join())
interface A { kind: 1; a: number; o: number[] } interface B { kind: 2; a: number; b?: number }
const a: A = { kind: 1, a: 7, o: [1] }
const b: B = a as unknown as B
console.log("another discriminant, fields in common:", b.a, b.b, (b as unknown) === a)
function fill<T extends object>(): T { const d: Record<string, unknown> = { only: 1 }; return d as T }
interface First { only: number; o?: number[] }
const first: First = fill<First>()
function viaOverload<T extends object>(kind: "a"): T
function viaOverload<T extends object>(kind: string, more: number): T
function viaOverload<T extends object>(kind: string, more?: number): T { const d: Record<string, unknown> = { only: kind.length + (more ?? 0) }; return d as T }
function under<T extends object>(flag: boolean, other: T): T { const d: Record<string, unknown> = { only: 2 }; return flag ? (d as T)! : other ?? (d as T) }
const overloaded: First = viaOverload<First>("abc", 1), chosen: First = under<First>(true, first), kept2: First = under<First>(false, first)
console.log("seen through:", overloaded.only, chosen.only, kept2.only, kept2 === first)
