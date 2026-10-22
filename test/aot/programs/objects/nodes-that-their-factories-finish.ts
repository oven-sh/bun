// One constructor function makes every node; a factory behind it stores the fields of its kind. A node is finished where its factory has stored the last of them.
// Here are the factories that do, and those that let a node out too early, fill it on one way only, fill it with what does not fit, or copy it name by name.
declare const console: { log(...values: unknown[]): void };

const lines: string[] = [];
function say(label: string, value: unknown) {
  lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value, (_, v) => v === undefined ? "#undefined" : typeof v === "function" ? "#function" : v)));
}

const enum Kind { Add = 1, Literal = 2, Group = 3, Negate = 4 }
interface Node { kind: Kind; pos: number; end: number; flags: number; parent: Node | undefined; }
interface AddNode extends Node { kind: Kind.Add; left: Expression; right: Expression; }
interface LiteralNode extends Node { kind: Kind.Literal; value: number; }
interface GroupNode extends Node { kind: Kind.Group; body: Expression; name: string; }
interface NegateNode extends Node { kind: Kind.Negate; operand: Expression; }
type Expression = AddNode | LiteralNode | GroupNode | NegateNode;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function NodeObject(this: Mutable<Node>, kind: Kind, pos: number, end: number) {
  this.pos = pos; this.end = end; this.kind = kind; this.flags = 0; this.parent = undefined;
}
const objectAllocator = { getNodeConstructor: () => NodeObject as any as new (kind: Kind, pos: number, end: number) => Node };
let NodeConstructor: (new (kind: Kind, pos: number, end: number) => Node) | undefined;
function createBaseNode<T extends Node>(kind: T["kind"]): Mutable<T> {
  return new (NodeConstructor || (NodeConstructor = objectAllocator.getNodeConstructor()))(kind, -1, -1) as Mutable<T>;
}
function createBaseNodeAt<T extends Node>(kind: T["kind"], pos: any, end: any): Mutable<T> {
  return new (NodeConstructor || (NodeConstructor = objectAllocator.getNodeConstructor()))(kind, pos, end) as Mutable<T>;
}
function createLiteral(value: number): LiteralNode { const node = createBaseNode<LiteralNode>(Kind.Literal); node.value = value; return node; }
function createAdd(left: Expression, right: Expression): AddNode { const node = createBaseNode<AddNode>(Kind.Add); node.left = left; node.right = right; return node; }
function createGroup(body: Expression, name: string): GroupNode { const node = createBaseNode<GroupNode>(Kind.Group); node.body = body; node.name = name; return node; }
function createNegate(operand: Expression): NegateNode { const node = createBaseNode<NegateNode>(Kind.Negate); node.operand = operand; return node; }

// What typed code reads of a node.
function describe(node: Expression | undefined): unknown {
  if (!node) return "none";
  switch (node.kind) {
    case Kind.Add: return ["add", node.pos, node.end, node.flags, describeShallow(node.left), describeShallow(node.right)];
    case Kind.Literal: return ["literal", node.pos, node.end, node.flags, node.value];
    case Kind.Group: return ["group", node.pos, node.end, node.flags, describeShallow(node.body), node.name];
    case Kind.Negate: return ["negate", node.pos, node.end, node.flags, describeShallow(node.operand)];
  }
  return ["other", (node as any).kind];
}
function describeShallow(node: Expression | undefined): unknown { return node ? node.kind : node; }
function keysOf(node: object) { return Object.keys(node).join(); }
function evaluate(node: Expression): number {
  switch (node.kind) {
    case Kind.Add: return evaluate(node.left) + evaluate(node.right);
    case Kind.Literal: return node.value;
    case Kind.Group: return evaluate(node.body);
    case Kind.Negate: return -evaluate(node.operand);
  }
}

// The plain factories, often.
{
  let total = 0;
  for (let i = 0; i < 3000; i++) total += evaluate(createAdd(createLiteral(i), createNegate(createGroup(createLiteral(i >> 1), "g" + (i & 3)))));
  say("plain", total);
  const one = createAdd(createLiteral(1), createLiteral(2));
  say("one", [describe(one), keysOf(one), describe(one.left), keysOf(one.left)]);
}

// A node that gets out before it is filled.
const seen: unknown[] = [];
let held: Expression | undefined;
function look(node: Expression) { held = node; seen.push(describe(node), keysOf(node), "left" in node, (node as any).right === undefined); }
function createAddSeenEarly(left: Expression, right: Expression): AddNode {
  const node = createBaseNode<AddNode>(Kind.Add);
  look(node);
  node.left = left;
  look(node);
  node.right = right;
  look(node);
  return node;
}
{
  for (let i = 0; i < 300; i++) { seen.length = 0; createAddSeenEarly(createLiteral(i), createLiteral(i + 1)); }
  say("seen early", seen);
  say("held", [describe(held), evaluate(held!)]);
}

// One way fills, the other does not.
function createAddPerhaps(left: Expression, right: Expression | undefined): AddNode {
  const node = createBaseNode<AddNode>(Kind.Add);
  node.left = left;
  if (right) node.right = right;
  return node;
}
{
  const out: unknown[] = [];
  for (let i = 0; i < 300; i++) { const node = createAddPerhaps(createLiteral(i), i % 3 ? createLiteral(1) : undefined); if (i > 295) out.push(describe(node), keysOf(node), "right" in node); }
  say("perhaps", out);
  const late = createAddPerhaps(createLiteral(5), undefined);
  (late as Mutable<AddNode>).right = createLiteral(6);
  say("filled later", [describe(late), keysOf(late), evaluate(late)]);
}

// What does not fit: in the maker's own fields, and in the factory's.
function createLiteralAt(value: any, pos: any, end: any): LiteralNode { const node = createBaseNodeAt<LiteralNode>(Kind.Literal, pos, end); node.value = value; return node; }
{
  const out: unknown[] = [];
  const odd: any[] = [[1, 2, 3], [1.5, 2, 3], ["text", 2, 3], [1, "pos", 3], [1, 2, undefined], [undefined, 2, 3], [null, null, null], [1, 2.5, 1e20], [{ valueOf() { return 9; } }, 2, 3]];
  for (let round = 0; round < 100; round++) for (const [value, pos, end] of odd) { const node = createLiteralAt(value, pos, end); if (round === 99) out.push(describe(node), keysOf(node)); }
  say("what does not fit", out);
  const add: any = createAdd(createLiteral(1), createLiteral(2));
  const wrong = createAdd("left" as any, 7 as any);
  say("no nodes", [describe(wrong), keysOf(wrong), typeof (wrong as any).left]);
  add.left = "now text"; say("text later", [describe(add), keysOf(add)]);
}

// A factory that throws on its way, and one whose node is caught by a closure.
function createAddOrThrow(left: Expression, right: Expression, fail: boolean, keep: (node: AddNode) => void): AddNode {
  const node = createBaseNode<AddNode>(Kind.Add);
  node.left = left;
  if (fail) { keep(node); throw new Error("no"); }
  node.right = right;
  return node;
}
{
  let kept: AddNode | undefined, thrown = 0;
  for (let i = 0; i < 300; i++) { try { createAddOrThrow(createLiteral(i), createLiteral(i), i % 50 === 49, node => { kept = node; }); } catch { thrown++; } }
  say("thrown", [thrown, describe(kept), keysOf(kept!), "right" in kept!]);
}

// A copy name by name, as a tree is cloned.
function clone<T extends Expression>(node: T): T {
  const copy = createBaseNode<T>(node.kind as T["kind"]) as any;
  for (const key in node) { if (Object.hasOwn(copy, key) || !Object.hasOwn(node, key)) continue; copy[key] = (node as any)[key]; }
  return copy;
}
{
  let total = 0;
  const source = createAdd(createGroup(createLiteral(4), "inner"), createNegate(createLiteral(3)));
  for (let i = 0; i < 300; i++) total += evaluate(clone(source)) + evaluate(clone(source.left)) + evaluate(clone(source.right));
  say("clones", [total, describe(clone(source)), keysOf(clone(source)), describe(clone(source.left)), keysOf(clone(source.left))]);
}

// The fields in another order, a kind that only the run knows, the constructor reached in other ways.
function createAddBackwards(left: Expression, right: Expression): AddNode { const node = createBaseNode<AddNode>(Kind.Add); node.right = right; node.left = left; return node; }
function createOfKind(kind: Kind): Node { return createBaseNode<Node>(kind); }
{
  const backwards = createAddBackwards(createLiteral(1), createLiteral(2));
  say("backwards", [describe(backwards), keysOf(backwards), evaluate(backwards)]);
  const bare = [1, 2, 3, 4, 5, 0].map(kind => createOfKind(kind as Kind));
  say("bare", bare.map(node => [describe(node as Expression), keysOf(node)]));
  const reflected = Reflect.construct(NodeObject, [Kind.Add, 1, 2]) as AddNode;
  say("reflected", [describe(reflected), keysOf(reflected)]);
  const called: any = { own: true }; (NodeObject as any).call(called, Kind.Literal, 3, 4);
  say("called", [describe(called), keysOf(called)]);
  class Below extends (NodeObject as any as new (kind: Kind, pos: number, end: number) => Node) { extra = 1; }
  const below: any = new Below(Kind.Negate, 5, 6);
  say("below", [describe(below), keysOf(below)]);
}

console.log(lines.join("\n"));
