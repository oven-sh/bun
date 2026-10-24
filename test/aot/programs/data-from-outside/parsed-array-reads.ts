// Every common way to read the elements of a parsed JSON array through an array type.
interface Num { n: number; m?: number }
function attempt(label: string, f: () => unknown) { try { console.log(label + ":", String(f())) } catch (e) { console.log(label + ":", (e as Error).constructor.name) } }
const text = '[{"n":1},{"n":1.5},{"n":2,"m":3}]'
const fresh = (): Num[] => JSON.parse(text) as Num[]
const touch = (x: Num) => { x.n *= 2; x.m ??= 7; return x.n }
attempt("index", () => { const a = fresh(); let t = 0; for (let i = 0; i < a.length; i++) t += touch(a[i]); return t })
attempt("for of", () => { const a = fresh(); let t = 0; for (const x of a) t += touch(x); return t })
attempt("for of, parameter", () => { const f = (a: Num[]) => { let t = 0; for (const x of a) t += x.n; return t }; return f(fresh()) })
attempt("forEach", () => { const a = fresh(); let t = 0; a.forEach(x => { t += touch(x) }); return t })
attempt("map", () => fresh().map(x => touch(x)).join())
attempt("map, by name", () => fresh().map(touch).join())
attempt("reduce", () => fresh().reduce((t, x) => t + x.n, 0))
attempt("filter, then index", () => fresh().filter(x => x.n > 1)[0].n)
attempt("find", () => fresh().find(x => x.n > 1)!.n)
attempt("destructuring", () => { const [x, y] = fresh(); return x.n + y.n })
attempt("spread, then index", () => [...fresh()][1].n)
attempt("at", () => fresh().at(-1)!.n)
attempt("pop", () => fresh().pop()!.n)
attempt("entries", () => { let t = 0; for (const [i, x] of fresh().entries()) t += i + x.n; return t })
attempt("annotated, for of", () => { const a: Num[] = JSON.parse(text); let t = 0; for (const x of a) t += x.n; return t })
export {};
