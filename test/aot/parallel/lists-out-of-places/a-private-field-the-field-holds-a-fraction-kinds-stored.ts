// Made by test/aot/tools/generate-lists-out-of-places.py.
interface Node { kind: number; next: Node | null }
class Other { next: Node | null = null; kind: number; constructor(kind: number) { this.kind = kind; } }
let calls = 0;
class Holder { #nodes: Node[]; constructor(list: Node[]) { this.#nodes = list; } get(): Node[] { return this.#nodes; } }
function hold(list: Node[]): Holder { return new Holder(list); }
function make(): Node[] {
  const list: Node[] = [];
  for (let i = 0; i < 5; i++) list.push(i === 2 ? { kind: 3.5, next: null } : { kind: i & 3, next: null });
  return list;
}
function run(holder: Holder): string {
  const list = holder.get();
  for (let i = 0; i < list.length; i++) list[i].kind = i;
  return list.map(node => String(node.kind)).join();
}
function safely(): string {
  try {
    return run(hold(make())) + " " + calls;
  } catch (error: any) {
    return "thrown: " + error.name + " " + calls;
  }
}
for (let turn = 0; turn < 3; turn++) console.log(safely());
