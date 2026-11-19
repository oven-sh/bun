// A typed function is handed to text that becomes code at run time, and called from there: an intersection type and a branded number.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
type Named = Point & { name: string };
type Branded = number & { __brand: "id" };
function probe(n: Named, id: Branded): number {
  return n.x + n.name.length + id + 1;
}
console.log(open(probe)({ ...pointAt(1), name: "n" }, 4 as Branded));
