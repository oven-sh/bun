// A constructor function that makes the objects of a tagged union is constructed by Reflect.construct for another function as new.target.
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
function NodeMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function Other(this: any) { this.other = true; }
Other.prototype.who = function () { return "other"; };
function tellOf(n: any): string { return String(n.kind) + " " + n.pos + " " + Object.keys(n).join() + " " + (n instanceof Node) + " " + (n instanceof (Other as any)) + " " + typeof n.who; }

function deed(kind: number, target: Function): string {
  return tellOf(Reflect.construct(Node, [kind, 3], target));
}
console.log(deed(1, Other));
console.log(deed(1, Node), deed(2, Object), deed(2, Map), deed(9, Other));
let said = "";
for (let i = 0; i < 200; i++) said = deed(i % 4, i % 3 ? Other : Node);
console.log(said);
Other.prototype = { who: 5 } as any;
console.log(deed(1, Other), deed(2, Node), tellOf(new Node(1, 1)));
