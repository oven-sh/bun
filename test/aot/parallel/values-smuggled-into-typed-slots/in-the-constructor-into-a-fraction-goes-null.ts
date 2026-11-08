// the road: in the constructor . the slot is held to: a fraction . what is smuggled: null
class Foo { p: string = "foo-p"; n: number = 1; }
class Bar { q: string = "bar-q"; r: number = 2; }
class A { x: Foo | null; y: number = 1; constructor(v: Foo | null) { this.x = v; } }
class B { x: number; y: number = 2; constructor(v: number) { this.x = v; } }
const unseen = (0, eval)("(x) => x");
function make(C: any, v: any): any { return new C(v); }
function read(b: B): string { try { return String(String(b.x * 2)); } catch (error) { return (error as Error).constructor.name; } }
const peek = (0, eval)("(o) => typeof o.x + '/' + Object.keys(o).join()");
const said = new Map<string, number>();
for (let i = 0; i < 300; i++) {
  const v = unseen(null), a = unseen(make(A, v)), b = unseen(make(B, v));
  const line = read(b) + " " + peek(b);
  said.set(line, (said.get(line) ?? 0) + 1);
}
console.log([...said].map(([line, times]) => line + " x" + times).join(" | "));
