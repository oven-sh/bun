// Made by test/aot/tools/generate-lists-out-of-places.py.
interface Node { kind: number; next: Node | null }
class Other { next: Node | null = null; kind: number; constructor(kind: number) { this.kind = kind; } }
let calls = 0;
type Holder = () => Node[];
function hold(list: Node[]): Holder { return () => list; }
function make(): Node[] {
  const list: Node[] = [];
  for (let i = 0; i < 5; i++) list.push(i === 2 ? ({ next: null } as any) : { kind: i & 3, next: null });
  return list;
}
function run(holder: Holder): string {
  const list = holder();
  let s = 0;
  for (const node of list) s += node.kind;
  return String(s);
}
function safely(): string {
  try {
    return run(hold(make())) + " " + calls;
  } catch (error: any) {
    return "thrown: " + error.name + " " + calls;
  }
}
for (let turn = 0; turn < 3; turn++) console.log(safely());
