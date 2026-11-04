// One constructor function makes three kinds of object that a literal `kind` tells apart, and gives `original` the constant undefined. The key is there in every kind, in its place, whether anything was stored or not.
interface Base { kind: number; pos: number; parent: Base; original?: Base }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
interface Pair extends Base { kind: 3; left: Base; right: Base }
function NodeMaker(this: Base, kind: number) { this.kind = kind; this.pos = 0; this.parent = undefined!; this.original = undefined; }
const Node = NodeMaker as unknown as new (kind: number) => Base;
function num(value: number): Num { const node = new Node(1) as Num; node.value = value; return node; }
function str(text: string): Str { const node = new Node(2) as Str; node.text = text; return node; }
function pair(left: Base, right: Base): Pair { const node = new Node(3) as Pair; node.left = left; node.right = right; left.parent = node; right.parent = node; return node; }
function from(node: Base, original: Base) { node.original = original; return node.original === original ? 1 : 0; }
const one = num(1); const two = str("two"); const both = pair(one, two);
console.log(Object.keys(one).join() + " " + Object.keys(both).join() + (one.original === undefined ? " left " : " filled ") + String(from(two, one)) + (two.original === one ? " filled" : " left") + (one.parent === both ? " below" : " alone"));
