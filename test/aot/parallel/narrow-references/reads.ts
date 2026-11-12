class Base { kind: number; constructor(kind: number) { this.kind = kind; } }
class Ident extends Base { text: string; constructor(text: string) { super(1); this.text = text; } }
class Literal extends Base { pad: number; text: string; constructor(text: string) { super(2); this.pad = 1; this.text = text; } }
class Computed extends Base { inner: Base | null | undefined; outer: Base | undefined; constructor(inner: Base | null) { super(3); this.inner = inner; this.outer = undefined; } }
class Entry { kind: number; flags: number; constructor(kind: number) { this.kind = kind; this.flags = 0; } }
class Prop extends Entry { name: Base; init: Base | undefined; type: Base | undefined; constructor(name: Base, init: Base | undefined) { super(10); this.name = name; this.init = init; this.type = undefined; } }
class Method extends Entry { body: Entry | undefined; name: Base; constructor(name: Base, body: Entry | undefined) { super(11); this.body = body; this.name = name; } }
class Call extends Entry { target: Entry | undefined; other: Entry | undefined; third: Entry | undefined; constructor(target: Entry | undefined) { super(12); this.target = target; this.other = undefined; this.third = target; } }
const bases: Base[] = []; for (let i = 0; i < 20; i++) bases.push(i % 5 === 4 ? new Literal("l" + i) : i % 7 === 6 ? new Computed(i % 2 ? null : bases[0]) : new Ident("i" + i));
const entries: Entry[] = []; for (let i = 0; i < 120; i++) entries.push(i % 3 === 0 ? new Prop(bases[i % 20], i % 2 ? bases[(i * 3) % 20] : undefined) : i % 3 === 1 ? new Method(bases[i % 20], entries[i >> 1]) : new Call(i % 4 ? entries[i >> 1] : undefined));
(globalThis as any).keep = [Base, Ident, Literal, Computed, Entry, Prop, Method, Call, bases, entries];
function same(a: Entry, b: Entry): boolean { return (a as Prop).name.kind === (b as Prop).name.kind && ((a as Prop).name as Ident).text === ((b as Prop).name as Ident).text; }
function inner(a: Entry): unknown { return ((a as Prop).init as Computed).inner; }
function innerKind(a: Entry): number { return ((a as Prop).init as Computed).inner!.kind; }
function targetKind(a: Entry): number { return ((a as Call).target as Prop).name.kind; }
function thirdInit(a: Entry): unknown { return ((a as Call).third as Prop).init; }
function walk(list: Entry[]): number { let n = 0, last: unknown = undefined; for (const a of list) { const init = (a as Prop).init; if (init) n += init.kind; if (last === init) n++; last = init; const target = (a as Call).target; n += target === undefined ? 1 : target === null ? 2 : target.kind; } return n; }
const reads: ((a: Entry) => unknown)[] = [inner, innerKind, targetKind, thirdInit]; (globalThis as any).reads = [reads, same, walk];
const named = entries.filter(a => a instanceof Prop || a instanceof Method);
let total = 0, log = "";
for (let k = 0; k < 20; k++) { total += walk(entries); for (let i = 1; i < named.length; i++) if (same(named[i - 1], named[i])) total++; if (k === 10) for (const a of entries) if (a instanceof Prop) a.init = a.init ? undefined : bases[k]; }
const odd: any[] = [...entries.slice(0, 40), undefined, null, 5, "text", { name: { kind: 1, text: "o" } }, { name: null }, { name: undefined }, { name: 7, init: 5 }, { init: { inner: 3 }, target: { name: { kind: 9 } }, third: { init: "i" } }, { target: null, third: undefined, init: null }, bases[0]];
for (const a of odd) for (const read of reads) try { const v = read(a); log += v instanceof Base ? "b" + v.kind : String(v); } catch (e) { log += (e as Error).constructor.name[0]; }
for (const a of odd) for (const b of odd.slice(-12)) try { total += same(a, b) ? 1 : 0; } catch { total += 3; }
try { total += walk(odd); } catch (e) { log += (e as Error).constructor.name; }
console.log(total, log);
