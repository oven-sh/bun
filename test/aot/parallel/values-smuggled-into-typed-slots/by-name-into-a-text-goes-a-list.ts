// the road: by name . the slot is held to: a text . what is smuggled: a list
class Foo { p: string = "foo-p"; n: number = 1; }
class Bar { q: string = "bar-q"; r: number = 2; }
class A { x: number[] = []; y: number = 1; }
class B { x: string = "b"; y: number = 2; }
const unseen = (0, eval)("(x) => x");
function store(o: any, v: any): void { o.x = v; }
function read(b: B): string { try { return String(b.x.length + ":" + b.x.charCodeAt(0)); } catch (error) { return (error as Error).constructor.name; } }
const peek = (0, eval)("(o) => typeof o.x + '/' + Object.keys(o).join()");
const said = new Map<string, number>();
for (let i = 0; i < 300; i++) {
  const a = unseen(new A()), b = unseen(new B()), v = unseen([1, 2, 3]);
  try { store(a, v); store(b, v); } catch (error) { said.set((error as Error).constructor.name, 1); }
  const line = read(b) + " " + peek(b);
  said.set(line, (said.get(line) ?? 0) + 1);
}
console.log([...said].map(([line, times]) => line + " x" + times).join(" | "));
