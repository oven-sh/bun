// the road: deleted and stored again . the property: an accessor with a setter . the same class . it holds an object
class Bar { q: string = "bar-q"; r: number; constructor(r: number = 2) { this.r = r; } }
class A { x: Bar = new Bar(); y: number = 1; }
class B { x: Bar = new Bar(); y: number = 2; }
const unseen = (0, eval)("(x) => x");
const seen: string[] = [];
function store(o: any, v: any): void { delete o.x; o.x = v; }
function read(b: B): string { try { return String(b.x.q + ":" + b.x.r); } catch (error) { return (error as Error).constructor.name; } }
const said = new Map<string, number>();
for (let i = 0; i < 300; i++) {
  const a = unseen(new B()), b = unseen(new B()), v = unseen(new Bar(i));
  Object.defineProperty(b, "x", { get() { return new Bar(); }, set(w) { seen.push(typeof w); }, configurable: true });
  let thrown = "-";
  try { store(a, v); store(b, v); } catch (error) { thrown = (error as Error).constructor.name; }
  const line = (read(b) + " " + thrown + " " + seen.length).replace(/[0-9]+/g, "#");
  said.set(line, (said.get(line) ?? 0) + 1);
}
console.log([...said].map(([line, times]) => line + " x" + times).join(" | "));
