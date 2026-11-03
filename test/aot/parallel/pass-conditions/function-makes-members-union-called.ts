// One function makes both members of a union, by the tag it is given. It is also called for an object that is there already, constructed for another new.target, and may return another object.
interface Base {
  kind: number;
  pos: number;
}
interface Num extends Base {
  kind: 1;
  value: number;
}
interface Str extends Base {
  kind: 2;
  text: string;
}
type Either = Num | Str;
const spare = { kind: 1, pos: -1, value: -1, spare: true };
function NodeMaker(this: Base, kind: number, other?: boolean) {
  this.kind = kind;
  this.pos = 0;
  if (other) return spare;
}
const Node = NodeMaker as unknown as new (kind: number, other?: boolean) => Base;
function num(v: number): Num {
  const n = new Node(1) as Num;
  n.value = v;
  return n;
}
function str(s: string): Str {
  const n = new Node(2) as Str;
  n.text = s;
  return n;
}
function read(one: Either): string {
  return one.kind === 1 ? "num " + one.value : "str " + one.text;
}
class Other {
  other() {
    return "other";
  }
}
for (let at = 0; at < 4; at++) {
  console.log(read(num(at)), read(str("s" + at)));
  const another: any = new Node(1 + (at % 2), true);
  console.log(another === spare, JSON.stringify(another));
  const under: any = Reflect.construct(Node, [1 + (at % 2)], Other);
  console.log(under.other(), JSON.stringify(under), under instanceof Node);
  const handed: any = { mine: at };
  const answer = (NodeMaker as any).call(handed, 1 + (at % 2));
  console.log(JSON.stringify(handed), answer);
}
