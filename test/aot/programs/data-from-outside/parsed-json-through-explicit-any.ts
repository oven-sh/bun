// Parsed JSON passes through the program's own `any` or `unknown` (a result, a parameter, a property, a `yield`) before it reaches a declared type. Any object passes, a member that is missing reads undefined, and a member of another kind throws a TypeError where typed code reads it.
function row(name: string, run: () => unknown): void { try { console.log(name, "|", run()) } catch (e) { console.log(name, "| THROWN", (e as Error).constructor.name) } }
function pass(x: any): any { return x }
interface Settings { name: string; nested: { on: boolean } }
function show(x: Settings): string { return x.name + (x.nested ? x.nested.on : "-") }
row("what a function of the program yields as any", () => show(pass(JSON.parse('{"name":"n","nested":{"on":true}}')) as Settings))
interface Wanted { title: string; deep: { on: boolean } }
function showWanted(x: Wanted): string { return x.title + (x.deep ? x.deep.on : "-") }
function toWanted(x: unknown): Wanted { return x as Wanted }
row("a parameter of type unknown", () => showWanted(toWanted(JSON.parse('{"title":"u","deep":{"on":false}}'))))
row("less than the type says", () => JSON.stringify(toWanted({})) + toWanted({}).title + showWanted(toWanted({ title: 1 })))
interface Pair { a: number; b: { c: number } }
function sum(x: Pair): number { return x.a + x.b.c }
row("what a built-in yields as any", () => sum(Reflect.get({ v: JSON.parse('{"a":3,"b":{"c":4}}') }, "v") as Pair))
interface Held { p: number; q: { r: number } }
function sumHeld(x: Held): number { return x.p + x.q.r }
const held: { any: any } = { any: JSON.parse('{"p":5,"q":{"r":6}}') }
row("a property of type any in an annotated variable", () => { const r: Held = held.any; return sumHeld(r) + " " + (r === held.any) })
function* steps(flag: boolean): Generator<{ op: string }, string, { e: string } | string> { const r = flag ? { e: "LIT" } : yield { op: "stat" }; if (typeof r === "object" && r.e !== undefined && (r.e === "ENOENT" || r.e === "B")) return keep(r) ? r.e : "no"; return "ok" }
function keep(x: { e: string }): boolean { return x.e.length > 0 }
function run(g: Generator<any, any, any>) { let s = g.next(); while (!s.done) s = g.next(JSON.parse('{"e":"ENOENT"}')); return s.value }
row("the value of a yield", () => run(steps(false)) + " " + run(steps(true)))
