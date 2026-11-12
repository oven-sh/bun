// the road: a list pattern . the slot is held to: a boolean . what is smuggled: an object of another class
class Foo { p: string = "foo-p"; n: number = 1; }
class Bar { q: string = "bar-q"; r: number = 2; }
class A { x: Foo = new Foo(); y: number = 1; }
class B { x: boolean = false; y: number = 2; }
const unseen = (0, eval)("(x) => x");
function store(o: any, v: any): void { [o.x] = [v]; }
function read(b: B): string { try { return String((b.x ? "yes" : "no") + (b.x === true)); } catch (error) { return (error as Error).constructor.name; } }
const peek = (0, eval)("(o) => typeof o.x + '/' + Object.keys(o).join()");
const said = new Map<string, number>();
for (let i = 0; i < 300; i++) {
  const a = unseen(new A()), b = unseen(new B()), v = unseen(new Foo());
  try { store(a, v); store(b, v); } catch (error) { said.set((error as Error).constructor.name, 1); }
  const line = read(b) + " " + peek(b);
  said.set(line, (said.get(line) ?? 0) + 1);
}
console.log([...said].map(([line, times]) => line + " x" + times).join(" | "));
