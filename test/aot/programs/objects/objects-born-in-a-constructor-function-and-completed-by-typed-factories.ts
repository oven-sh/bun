// TypeScript's own way of making nodes: a constructor function stores what every node has, a factory gives the object its type and completes it.
interface Node { kind: number; pos: number; end: number; flags: number; parent: Node | undefined }
interface Identifier extends Node { escapedText: string; jsDoc: string[] | undefined; symbol: object | undefined }
interface BinaryExpression extends Node { left: Node; operatorToken: number; right: Node; jsDoc: string[] | undefined }
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
function NodeObject(this: Mutable<Node>, kind: number, pos: number, end: number) {
  this.pos = pos;
  this.end = end;
  this.kind = kind;
  this.flags = 0;
  this.parent = undefined;
}
const objectAllocator = { getNodeConstructor: () => NodeObject as any as new (kind: number, pos: number, end: number) => Node };
let NodeConstructor: (new (kind: number, pos: number, end: number) => Node) | undefined;
function createBaseNode<T extends Node>(kind: number): Mutable<T> {
  return new (NodeConstructor || (NodeConstructor = objectAllocator.getNodeConstructor()))(kind, -1, -1) as Mutable<T>;
}
function createIdentifier(text: string): Identifier {
  const node = createBaseNode<Identifier>(80);
  node.escapedText = text;
  node.jsDoc = undefined;
  node.symbol = undefined;
  return node;
}
function createBinaryExpression(left: Node, operatorToken: number, right: Node): BinaryExpression {
  const node = createBaseNode<BinaryExpression>(227);
  node.left = left;
  node.operatorToken = operatorToken;
  node.right = right;
  node.jsDoc = undefined;
  return node;
}
function count(node: Node): number {
  return node.kind === 227 ? count((node as BinaryExpression).left) + count((node as BinaryExpression).right) : (node as Identifier).escapedText.length;
}
function build(depth: number): Node {
  return depth === 0 ? createIdentifier("name") : createBinaryExpression(build(depth - 1), 40, build(depth - 1));
}
const rounds = Number(process.argv[2] || 3);
let total = 0;
let last: Node | undefined;
for (let round = 0; round < rounds; round++) total += count(last = build(10));
console.log(total, Object.keys(last!).join(","), Object.keys((last as BinaryExpression).left).join(","), JSON.stringify(createIdentifier("x")));
