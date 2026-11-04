// The keys of the objects of a tagged union are listed, after the fields that their interfaces declare were stored in another order than they are declared in.
interface Base { kind: number; pos: number }
interface Pair extends Base { kind: 1; left: number; right: number }
interface Name extends Base { kind: 2; text: string; right: number }
function NodeMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function listed(n: object): string {
  let byLoop = "";
  for (const key in n) byLoop += key + ";";
  return Object.keys(n).join() + " " + byLoop + " " + JSON.stringify(n) + " " + Object.getOwnPropertyNames(n).join();
}

function deed(backward: boolean): string {
  const p = new Node(1, 3) as Pair;
  if (backward) { p.right = 2; p.left = 1; } else { p.left = 1; p.right = 2; }
  return listed(p);
}
console.log(deed(false));
console.log(deed(true));
let said = "";
for (let i = 0; i < 200; i++) said = deed(i % 3 === 0);
console.log(said);
const name = new Node(2, 4) as Name;
name.right = 9;
(name as any).stray = 0;
name.text = "n";
console.log(listed(name), listed(new Node(1, 0)), listed(new Node(5, 0)), listed({ ...name }), listed(Object.assign({}, deed.length ? new Node(1, 1) : name)));
