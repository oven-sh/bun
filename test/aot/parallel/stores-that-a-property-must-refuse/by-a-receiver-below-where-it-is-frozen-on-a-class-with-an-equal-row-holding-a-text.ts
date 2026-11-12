// the road: by a receiver below . the property: frozen . a class with an equal row . it holds a text
class Bar { q: string = "bar-q"; r: number; constructor(r: number = 2) { this.r = r; } }
class A { x: string = "start"; y: number = 1; }
class B { x: string = "start"; y: number = 2; }
const unseen = (0, eval)("(x) => x");
const seen: string[] = [];
function store(o: any, v: any): void { Reflect.set(Object.getPrototypeOf(Object.create(o)), "x", v, o); }
function read(b: B): string { try { return String(b.x.length + b.x); } catch (error) { return (error as Error).constructor.name; } }
const said = new Map<string, number>();
for (let i = 0; i < 300; i++) {
  const a = unseen(new A()), b = unseen(new B()), v = unseen("stored" + i);
  Object.freeze(b);
  let thrown = "-";
  try { store(a, v); store(b, v); } catch (error) { thrown = (error as Error).constructor.name; }
  const line = (read(b) + " " + thrown + " " + seen.length).replace(/[0-9]+/g, "#");
  said.set(line, (said.get(line) ?? 0) + 1);
}
console.log([...said].map(([line, times]) => line + " x" + times).join(" | "));
