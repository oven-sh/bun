// Compound, logical and update assignments on typed fields, optional chaining, and the order in which receiver, key, old value and new value are evaluated.
interface Acc { n: number; s: string; opt?: number; word?: string; flag?: boolean; sub?: Acc }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function acc(): Acc { return { n: 1, s: "s" } }

// Every arithmetic and bit operator, results read back from the field.
const a = acc()
const results: number[] = []
a.n += 2; results.push(a.n); a.n -= 0.5; results.push(a.n); a.n *= 4; results.push(a.n); a.n /= 3; results.push(a.n); a.n %= 2; results.push(a.n); a.n **= 3; results.push(a.n)
a.n = 13; a.n <<= 28; results.push(a.n); a.n >>= 3; results.push(a.n); a.n >>>= 1; results.push(a.n); a.n |= 5; results.push(a.n); a.n &= -8; results.push(a.n); a.n ^= -1; results.push(a.n)
console.log(results.join())
a.s += 1; a.s += "x"; a.s += a.n; a.s += null; a.s += undefined; a.s += true
console.log(a.s)

// Prefix and postfix: the value of the expression against the value stored.
const u = acc()
console.log(u.n++, u.n, ++u.n, u.n, u.n--, u.n, --u.n, u.n, -u.n++, u.n, u.n++ + u.n++, u.n, u.n++ * 2 + ++u.n)
u.n = 0.5; console.log(u.n++, u.n, --u.n, u.n--, u.n)
u.n = 2147483647; console.log(u.n++, u.n, u.n--, u.n)
u.n = -0; console.log(Object.is(u.n++, -0), u.n, Object.is(u.n - 1, 0))

// Logical assignment on absent, undefined, falsy and truthy fields: whether it stores, what it evaluates to, where the key ends up.
const l = acc()
console.log(l.opt ??= 5, l.opt ??= 6, show(l))
console.log(l.word ||= "w", l.word ||= "v", l.flag &&= true, "flag" in l, show(l))
l.opt = 0; l.word = ""; l.flag = false
console.log(l.opt ??= 7, l.opt ||= 8, l.opt &&= 9, l.word ??= "a", l.word ||= "b", l.word &&= "c", l.flag ??= true, l.flag ||= true, l.flag &&= false, show(l))
l.opt = undefined
console.log("opt" in l, l.opt ??= 1, show(l))
delete l.opt
console.log(l.opt ??= 2, show(l))

// The right side is not evaluated, and nothing is stored, when the operator short-circuits: a frozen object does not complain.
const effects: string[] = []
function note<T>(label: string, v: T): T { effects.push(label); return v }
const f: Acc = Object.freeze({ n: 1, s: "s", opt: 3, word: "" })
console.log(f.opt ??= note("a", 1), f.opt ||= note("b", 1), f.word &&= note("c", "x"), attempt(() => f.word ||= note("d", "x")), attempt(() => f.flag ??= note("e", true)), attempt(() => { f.n += note("f", 1) }), attempt(() => f.n++), effects.join(), show(f))

// Order: receiver, then key, then the old value, then the right side, then the store.
const trace: string[] = []
const box = acc()
function recv(): Acc { trace.push("receiver"); return box }
function key(): "n" { trace.push("key"); return "n" }
function rhs(): number { trace.push("rhs:" + box.n); box.n = 100; return 1 }
recv()[key()] += rhs()
console.log(box.n, trace.join())
trace.length = 0; box.n = 5
recv().n = rhs() + box.n
console.log(box.n, trace.join())
trace.length = 0; box.n = 5
console.log(recv().n++ + rhs(), box.n, trace.join())

// The right side changes the receiver: it freezes it or deletes the field. (It turns the field into an accessor: type-rules/compound-assignments.)
const g1 = acc(), g2 = acc(), g4 = acc()
g2.opt = 1
console.log(attempt(() => { g1.n = (Object.freeze(g1), 5) }), g1.n, attempt(() => { g1.n += 1 }), g1.n)
g2.opt += (delete g2.opt, 10)
console.log(show(g2))
g4.sub = acc()
g4.sub.n += (g4.sub = acc(), 50)
console.log(g4.sub.n, show(g4))

// Optional chains: reads, calls, deletes, and that the rest of the chain is skipped.
const c: Acc = { n: 1, s: "c", sub: { n: 2, s: "d" } }
console.log(c.sub?.n, c.sub?.sub?.n, c.sub?.sub?.sub?.s.length, c.sub?.s.length, c.sub?.["n"], c.sub?.sub?.[note<"n">("skipped key", "n")], c.word?.length, c.word?.toUpperCase().length, c.opt?.toFixed(note("skipped arg", 1)), effects.includes("skipped key"), effects.includes("skipped arg"))
console.log(delete c.sub?.opt, delete c.sub?.sub?.opt, delete c.sub?.sub, show(c), (c.sub?.sub ?? c).n, (c.sub?.opt ?? 0) + 1)
if (c.sub) { c.sub.n++; c.sub.opt ??= c.sub.n; (c.sub.sub ??= acc()).n += 10 }
console.log(show(c))

// Chains of assignments, assignments as values, and a comma in the middle.
const x1 = acc(), x2 = acc(), nothing = undefined
x1.n = x2.n = 7
x1.opt = x2.opt = x1.n += 1
console.log(show(x1), show(x2), (x1.n = 3) + (x1.n += 4) + x1.n, (x2.s = "v").length, (x1.opt = nothing) ?? "u", show(x1))

// In a loop, over objects some of which have the field.
const many: Acc[] = []
for (let i = 0; i < 8; i++) many.push(i % 2 ? { n: i, s: "", opt: i } : { s: "", n: i })
for (const m of many) { m.opt ??= -1; m.n += m.opt; m.s += m.n; m.flag ||= m.n > 5 }
console.log(many.map(m => m.n + m.s + m.flag + Object.keys(m).join("")).join())
