// Seventeen ways to make a written type false at run time: `as`, `x!`, stores of another kind through any, Reflect.set, Object.assign and evaluated text, a deleted field, a field that becomes an
// accessor or read-only, a frozen object, another prototype, arguments, results and elements of another kind. None of them throws because of the type.
class Point { x: number = 1; y: number = 2; label: string = "p"; next: Point | null = null; }
interface Named { name: string; age: number }
function show(tag: string, run: () => unknown) {
  try { console.log(tag, JSON.stringify(run())); } catch (error) { console.log(tag, "THREW", (error as Error).constructor.name, (error as Error).message); }
}
function sum(p: Point): number { return p.x + p.y; }
function greet(n: Named): string { return n.name + ":" + n.age; }
const text: unknown = JSON.parse('{"name": 5, "age": "old"}');

show("as on a wrong shape", () => greet(text as Named));
show("as string on a number", () => { const v = (7 as unknown) as string; return typeof v; });
show("as then a method", () => { const v = (7 as unknown) as string; return (v as any).toFixed(1); });
show("non-null on null", () => { const p: Point | null = null as Point | null; const q = p!; return q === null; });
show("store a string into a number field through any", () => { const p = new Point(); (p as any).x = "s"; return [typeof p.x, sum(p)]; });
show("Reflect.set of another kind", () => { const p = new Point(); Reflect.set(p, "x", "s"); return [typeof p.x, sum(p)]; });
show("Object.assign of another kind", () => { const p = new Point(); Object.assign(p, { y: "t", label: 9 }); return [typeof p.y, typeof p.label, sum(p)]; });
show("delete a required field", () => { const p = new Point(); delete (p as any).x; return ["x" in p, sum(p)]; });
show("redefine a field as an accessor", () => { const p = new Point(); Object.defineProperty(p, "x", { get() { return 40; }, configurable: true }); return sum(p); });
show("redefine a field as read-only", () => { const p = new Point(); Object.defineProperty(p, "y", { value: 5, writable: false }); return sum(p); });
show("a reference field gets a number", () => { const p = new Point(); (p as any).next = 3; return typeof p.next; });
show("an argument of another kind", () => sum({ x: "a", y: "b" } as unknown as Point));
show("an array element of another kind", () => { const a: number[] = [1, 2]; (a as any).push("z"); return a.map(v => typeof v); });
show("evaluated text stores a misfit", () => { const p = new Point(); new Function("o", "o.x = 'e'; delete o.y;")(p); return [typeof p.x, "y" in p]; });
show("a result of another kind", () => { const f = (): number => ("r" as unknown) as number; return typeof f(); });
show("freeze then read", () => { const p = Object.freeze(new Point()); return sum(p); });
show("another prototype", () => { const p = new Point(); Object.setPrototypeOf(p, { extra: 1 }); return [(p as any).extra, sum(p)]; });
