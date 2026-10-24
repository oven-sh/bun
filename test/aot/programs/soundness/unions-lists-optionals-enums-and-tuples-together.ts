type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number } | { kind: "none" };
function area(s: Shape): number {
  switch (s.kind) {
    case "circle": return s.r * s.r * 3;
    case "square": return s.side * s.side;
    default: return 0;
  }
}
const shapes: Shape[] = [{ kind: "circle", r: 2 }, { kind: "square", side: 3 }, { kind: "none" }];
console.log(shapes.map(area).join());
const byKind = new Map<string, Shape[]>();
for (const s of shapes) (byKind.get(s.kind) ?? byKind.set(s.kind, []).get(s.kind)!).push(s);
console.log([...byKind].map(([k, v]) => k + v.length).join());
class Node<T> { next: Node<T> | null = null; constructor(public value: T) {} }
class List<T> implements Iterable<T> {
  head: Node<T> | null = null; size = 0;
  push(value: T): this { const n = new Node(value); n.next = this.head; this.head = n; this.size++; return this; }
  *[Symbol.iterator](): Iterator<T> { for (let n = this.head; n; n = n.next) yield n.value; }
}
const list = new List<Shape>().push(shapes[0]).push(shapes[1]);
console.log([...list].map(s => s.kind).join(), list.size);
const empty = new List<number>();
console.log([...empty].length, empty.head === null, Math.max(0, ...empty));
function first<T>(items: readonly T[], fallback: T): T { return items.length ? items[0] : fallback; }
console.log(first([], "fallback"), first([1], 2), first<Shape>([], { kind: "none" }).kind);
const optional: { a?: { b?: { c: number } } } = {};
console.log(optional.a?.b?.c ?? "nothing", optional?.a?.b === undefined);
optional.a = { b: { c: 5 } };
console.log(optional.a?.b?.c ?? "nothing");
enum Color { Red, Green = 5, Blue }
const names: Record<Color, string> = { [Color.Red]: "r", [Color.Green]: "g", [Color.Blue]: "b" };
console.log(Object.keys(names).join(), names[Color.Blue], Color[6], Color.Green);
const tuple: [string, number, ...boolean[]] = ["t", 1];
tuple.push(true);
console.log(tuple.length, tuple[2], tuple.slice(1).join());
async function load(id: number): Promise<{ id: number; tags: string[] }> { await null; return { id, tags: id ? ["x"] : [] }; }
Promise.all([load(0), load(1)]).then(rows => console.log(rows.map(r => r.id + ":" + r.tags.length + ":" + (r.tags[0]?.length ?? "-")).join()));
