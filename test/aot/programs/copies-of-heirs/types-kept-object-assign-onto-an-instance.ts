// Object.assign onto an instance returns that instance: it keeps its prototype, and what the prototype provides keeps its type.
// IR= 1 kept : number = 
// IR= 0 kept : undefined\|number = 
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
class C { a = 1; get b(): number { return this.a + 1 } }
function kept(a: number): number { const c: C = Object.assign(new C(), { a }); return c.b }
row("the getter", () => kept(5));
