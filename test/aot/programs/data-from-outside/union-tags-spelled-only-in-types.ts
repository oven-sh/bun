// Plain objects are used through a discriminated union whose tag "oval" is spelled in the type alone, never in code, so that it is an ordinary string in the object. Each object keeps its OWN tag string: here the first object that typed code has read dies, young, and its string with it, while objects that were old when typed code first read them live on. Then the same with full collections, where every object that typed code has read dies between the rounds and only one that it never read stays alive.
type Inner = { n: number };
type Circle = { kind: "circle"; inner: Inner; radius: number };
type Square = { kind: "square"; inner: Inner; side: number };
type Oval = { kind: "oval"; inner: Inner; wide: number };
type Figure = Circle | Square | Oval;
const shell: any = globalThis;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
function makeInner(n: number): Inner { return { n } }
function makeFigure(i: number, inner: Inner): Figure { return i % 2 ? { kind: "circle", inner, radius: i } : { kind: "square", inner, side: i } }
function area(figure: Figure): number { return figure.inner.n + (figure.kind === "circle" ? figure.radius * 3 : figure.kind === "square" ? figure.side * figure.side : figure.wide) }
function kindOf(figure: Figure): string { return figure.kind }
function grow(kind: unknown, inner: Inner, i: number): any { const figure: any = { kind }; figure.inner = inner; figure.wide = i; return figure }
function fresh(text: string): string { return text.split("").join("") }
function convertOne(inner: Inner): void { F.area(F.grow(F.fresh("oval"), inner, 1)) }
function convertAll(list: any[]): void { for (const o of list) F.area(o) }
function deep(k: number): number { return k <= 0 ? 0 : 1 + F.deep(k - 1) }
function churn(): number { let n = 0; for (let i = 0; i < 5000; i++) n += F.fresh("junk" + i).length; return n }
function kinds(list: any[]): string { const seen = new Map<string, number>(); for (const o of list) { const kind = F.kindOf(o) + ""; seen.set(kind, (seen.get(kind) ?? 0) + 1) } return [...seen].map(([kind, count]) => kind + " " + count).join(", ") }
function round(inner: Inner, count: number): string { const list: any[] = []; for (let i = 0; i < count; i++) list.push(F.grow(F.fresh("oval"), inner, i)); F.convertAll(list); return F.kinds(list) }
const F = { area, kindOf, grow, fresh, convertOne, convertAll, deep, churn, kinds, round };
const inner = makeInner(7);
console.log(area(makeFigure(1, inner)), area(makeFigure(2, inner)));

const old: any[] = [];
for (let i = 0; i < 50; i++) old.push(F.grow(F.fresh("oval"), inner, i));
collect(true); collect(true);
F.convertOne(inner); F.deep(80);
F.convertAll(old); F.deep(80);
collect(false); F.churn(); collect(false); F.churn();
console.log("old objects converted behind a young one:", F.kinds(old));

const unconverted = F.grow("none", inner, 0);
for (let i = 0; i < 6; i++) { console.log("round", i, F.round(inner, 40)); F.deep(80); collect(true); F.churn() }
console.log(Object.keys(unconverted).join());
