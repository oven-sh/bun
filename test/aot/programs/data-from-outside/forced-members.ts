// A `B` reaches a field of type `A` through a double cast and through `any`: any object passes an object type, and a member it does not have reads undefined.
interface A { a: number; shared?: string; o: number[] }
interface B { b: string; shared?: string; n: number }
interface Holder { item: A }
function attempt(label: string, f: () => unknown) { try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) } }
const makeA = (): A => ({ a: 1, o: [1] })
const makeB = (): B => ({ b: "b", shared: "s", n: 7 })
attempt("the forced cast", () => (makeB() as unknown as A).shared)
const h: Holder = { item: makeA() }
attempt("stored through any", () => { (h as any).item = makeB(); return "stored" })
attempt("typed, optional and in both", () => h.item.shared)
attempt("typed, a reference it lacks", () => h.item.o)
attempt("typed, a number it lacks", () => h.item.a)
attempt("typed, a number it lacks, in arithmetic", () => h.item.a + 1)
attempt("through any, what it lacks", () => (h.item as any).a)
attempt("through any, its own", () => (h.item as any).b + (h.item as any).n)
attempt("through any from the holder", () => (h as any).item.b)
attempt("typed store of what it lacks", () => { h.item.a = 5; return (h.item as any).a + " " + Object.keys(h.item).join() })
attempt("typed read after that", () => h.item.a + 1)
attempt("its own fields after that", () => (h.item as any).b + (h.item as any).n)
const other: Holder = { item: makeA() }
attempt("an A beside it", () => other.item.a + " " + other.item.o.length + " " + other.item.shared)
