// Made by test/aot/tools/generate-lists-out-of-places.py.
interface Node { kind: number; next: Node | null }
class Other { next: Node | null = null; kind: number; constructor(kind: number) { this.kind = kind; } }
let calls = 0;
class Holder { private kept: Node[]; constructor(list: Node[]) { this.kept = list; } get nodes(): Node[] { return this.kept; } }
function hold(list: Node[]): Holder { return new Holder(list); }
function make(): Node[] {
  const list: Node[] = [];
  for (let i = 0; i < 5; i++) list.push(i === 2 ? new Proxy({ kind: 0, next: null }, { get(target, key) { calls++; return key === "kind" ? 3 : undefined; } }) : { kind: i & 3, next: null });
  return list;
}
function run(holder: Holder): string {
  const list = holder.nodes;
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
