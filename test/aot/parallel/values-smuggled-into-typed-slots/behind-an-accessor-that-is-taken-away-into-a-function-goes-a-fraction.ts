// the road: behind an accessor that is taken away . the slot is held to: a function . what is smuggled: a fraction
class Foo { p: string = "foo-p"; n: number = 1; }
class Bar { q: string = "bar-q"; r: number = 2; }
class A { x: number = 1.5; y: number = 1; }
class B { x: () => string = () => "b"; y: number = 2; }
const unseen = (0, eval)("(x) => x");
function store(o: any, v: any): void { Object.defineProperty(o, "x", { get() { return 1; }, configurable: true }); Object.defineProperty(o, "x", { value: v, writable: true, enumerable: true, configurable: true }); }
function read(b: B): string { try { return String(b.x()); } catch (error) { return (error as Error).constructor.name; } }
const peek = (0, eval)("(o) => typeof o.x + '/' + Object.keys(o).join()");
const said = new Map<string, number>();
for (let i = 0; i < 300; i++) {
  const a = unseen(new A()), b = unseen(new B()), v = unseen(0.5);
  try { store(a, v); store(b, v); } catch (error) { said.set((error as Error).constructor.name, 1); }
  const line = read(b) + " " + peek(b);
  said.set(line, (said.get(line) ?? 0) + 1);
}
console.log([...said].map(([line, times]) => line + " x" + times).join(" | "));
