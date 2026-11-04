// Flags: --aot-disable=flow-results
// One function makes both members of a union, by the tag it is given. Called on an existing object, it stores both fields there.
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
function NodeMaker(this: Base, kind: number) {
  this.kind = kind;
  this.pos = 0;
}
const Node = NodeMaker as unknown as new (kind: number) => Base;
function num(value: number): Num {
  const made = new Node(1) as Num;
  made.value = value;
  return made;
}
function str(text: string): Str {
  const made = new Node(2) as Str;
  made.text = text;
  return made;
}
console.log(num(1).value, str("s").text);
const handed: any = { mine: 1 };
console.log((NodeMaker as any).call(handed, 2));
console.log(handed.kind + ":" + handed.pos + ":" + handed.mine);
