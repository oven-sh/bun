// The copy is made in the place that takes it: an argument, a store, an element, a result, a default, a member of a literal.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface S { a: number; b: number }
class C implements S { a = 1; get b(): number { return 2 } }
class Holder { held: S = { a: 0, b: 0 } }
interface Outer { inner: S }
const heir = (): S => new C();
const read = (s: S): number => s.b + 1;
const withDefault = (s: S = { ...heir() }): number => s.b + 1;
function* yielded(): Generator<S> { yield { ...heir() } }
const later = async (): Promise<S> => ({ ...heir() });
row("an argument", () => read({ ...heir() }));
row("a store to a field", () => { const holder = new Holder(); holder.held = { ...heir() }; return holder.held.b + 1 });
row("a store to a variable", () => { let s: S = { a: 0, b: 0 }; s = { ...heir() }; return s.b + 1 });
row("an element", () => { const list: S[] = [{ ...heir() }]; return list[0].b + 1 });
row("pushed", () => { const list: S[] = []; list.push({ ...heir() }); return list[0].b + 1 });
row("a member of a literal", () => { const outer: Outer = { inner: { ...heir() } }; return outer.inner.b + 1 });
row("a default", () => withDefault());
row("yielded", () => { for (const each of yielded()) return each.b + 1 });
row("one arm of a conditional", () => { const s: S = heir().a > 0 ? { ...heir() } : { a: 0, b: 0 }; return s.b + 1 });
row("satisfies", () => ({ ...heir() } satisfies S).b + 1);
row("in a map", () => { const map = new Map<string, S>(); map.set("k", { ...heir() }); return map.get("k")!.b + 1 });
later().then(s => console.log("awaited: " + (s.b + 1)));
