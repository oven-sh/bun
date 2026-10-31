// One constructor function makes the nodes of every kind, and the interface that writes the kind says which further names a node gets. What the maker stores, numbers among it,
// is answered for by one test of the node. Every node below goes through the same readers, whatever has happened to it.
const out: string[] = [];
const suffix = process.argv[2] ?? "";
const hide = new Function("value", "return value" + suffix) as <V>(value: V) => V;
const storeUnseen = new Function("object", "key", "value", "object[key] = value" + suffix) as (object: object, key: string, value: unknown) => void;
const removeUnseen = new Function("object", "key", "return delete object[key]" + suffix) as (object: object, key: string) => boolean;

const enum Kind {
  Name = 1,
  Call = 2,
  Sum = 3,
  Block = 4,
}
interface Node {
  kind: Kind;
  pos: number;
  end: number;
  flags: number;
  id: number;
  parent: Node | undefined;
}
interface Name extends Node {
  kind: Kind.Name;
  text: string;
}
interface Call extends Node {
  kind: Kind.Call;
  callee: Node;
  operands: Node[];
}
interface Sum extends Node {
  kind: Kind.Sum;
  left: Node;
  right: Node;
}
interface Block extends Node {
  kind: Kind.Block;
  statements: Node[];
}

function NodeObject(this: Node, kind: Kind, pos: number, end: number) {
  this.pos = pos;
  this.end = end;
  this.kind = kind;
  this.id = 0;
  this.flags = 0;
  this.parent = undefined;
}
const NodeConstructor = NodeObject as unknown as new (kind: Kind, pos: number, end: number) => Node;

let nextId = 0;
function finish<N extends Node>(node: N, flags: number): N {
  node.id = ++nextId;
  node.flags |= flags;
  return node;
}
function createName(text: string, pos: number): Name {
  const node = new NodeConstructor(Kind.Name, pos, pos + text.length) as Name;
  node.text = text;
  return finish(node, 1);
}
function createCall(callee: Node, operands: Node[]): Call {
  const node = new NodeConstructor(Kind.Call, callee.pos, callee.end + 2) as Call;
  node.callee = callee;
  node.operands = operands;
  callee.parent = node;
  for (const operand of operands) operand.parent = node;
  return finish(node, 2);
}
function createSum(left: Node, right: Node): Sum {
  const node = new NodeConstructor(Kind.Sum, left.pos, right.end) as Sum;
  node.left = left;
  node.right = right;
  left.parent = node;
  right.parent = node;
  return finish(node, 4);
}
function createBlock(statements: Node[]): Block {
  const node = new NodeConstructor(Kind.Block, 0, 100) as Block;
  node.statements = statements;
  for (const statement of statements) statement.parent = node;
  return finish(node, 8);
}

function isName(node: Node): node is Name {
  return node.kind === Kind.Name;
}
function widthOf(node: Node): number {
  return node.end - node.pos;
}
function hasFlag(node: Node, flag: number): boolean {
  return (node.flags & flag) !== 0;
}
function depthOf(node: Node): number {
  let depth = 0;
  for (let current = node.parent; current !== undefined; current = current.parent) depth++;
  return depth;
}
function describe(node: Node): string {
  switch (node.kind) {
    case Kind.Name:
      return (node as Name).text;
    case Kind.Call:
      return describe((node as Call).callee) + "(" + (node as Call).operands.map(describe).join() + ")";
    case Kind.Sum:
      return describe((node as Sum).left) + "+" + describe((node as Sum).right);
    case Kind.Block:
      return "{" + (node as Block).statements.map(describe).join(";") + "}";
  }
  return "?" + String((node as Node).kind);
}
function read(node: Node): unknown[] {
  return [node.kind, typeof node.kind, node.pos, node.end, node.flags, typeof node.flags, node.id, isName(node), widthOf(node), hasFlag(node, 1), hasFlag(node, 6), depthOf(node), Object.keys(node).join()];
}
function show(name: string, value: unknown) {
  out.push(name + ": " + JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : v)));
}

function build(): Block {
  const a = createName("a", 1);
  const b = createName("bb", 3);
  const f = createName("f", 6);
  return hide(createBlock([createSum(a, b), createCall(f, [createName("c", 8), createSum(createName("d", 10), createName("e", 12))])]));
}
function forEachNode(node: Node, visit: (node: Node) => void) {
  visit(node);
  switch (node.kind) {
    case Kind.Call:
      forEachNode((node as Call).callee, visit);
      (node as Call).operands.forEach(operand => forEachNode(operand, visit));
      break;
    case Kind.Sum:
      forEachNode((node as Sum).left, visit);
      forEachNode((node as Sum).right, visit);
      break;
    case Kind.Block:
      (node as Block).statements.forEach(statement => forEachNode(statement, visit));
      break;
  }
}

const tree = build();
show("the tree", describe(tree));
forEachNode(tree, node => show("a node", read(node)));
for (let i = 0; i < 30; i++) forEachNode(build(), read);

for (const key of ["kind", "pos", "end", "flags", "id"]) {
  for (const [word, value] of [["undefined", undefined], ["null", null], ["a fraction", 1.5], ["a large number", 2 ** 40], ["a string", "text"]] as const) {
    const changed = build();
    const sum = changed.statements[0];
    storeUnseen(sum, key, value);
    show(`${word} under ${key} by code that nobody sees`, read(sum));
    show(`${word} under ${key}: the tree`, describe(changed));
    const byName: any = build().statements[1];
    byName[key] = value;
    show(`${word} under the computed key ${key}`, read(byName));
    finish(byName, 16);
    show(`${word} under ${key}, finished again`, read(byName));
  }
  const removed = build().statements[0];
  removeUnseen(removed, key);
  show(`${key} deleted by code that nobody sees`, read(removed));
  (removed as any)[key] = 2;
  show(`${key} stored again`, read(removed));
}

const twice = createName("twice", 5);
NodeObject.call(twice, Kind.Sum, 7, 9);
show("the maker called on a finished node", read(hide(twice)));
show("a kind that no interface writes", read(hide(new NodeConstructor(9 as Kind, 1, 4))));
show("a kind that is no number", read(hide(new NodeConstructor(hide<unknown>(undefined) as Kind, hide<unknown>(null) as number, 4))));
show("for another new.target", read(hide(Reflect.construct(NodeConstructor, [Kind.Call, 2, 3], function Other() {}))));

console.log(out.join("\n"));
