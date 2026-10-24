// A family of nodes made by one constructor function, told apart by `kind`, whose later members differ by kind: one name may hold a number in one kind and a node or a string in another.
// `clone[key] = node[key]` under one key moves each member to the member of the same name. Between two nodes of one kind every value fits. Between two kinds it may not, and the typed readers must see what was stored.
declare const console: { log(...values: unknown[]): void };
const lines: string[] = [];
function say(label: string, value: unknown) { lines.push(label + ": " + JSON.stringify(value, (_, v) => v === undefined ? "#undefined" : typeof v === "function" ? "#function" : v)); }

const enum Kind { Name = 1, Unary = 2, Binary = 3, Text = 4 }
interface Node { kind: Kind; pos: number; end: number; flags: number; parent: Node | undefined }
interface Name extends Node { kind: Kind.Name; text: string; operator?: undefined }
interface Unary extends Node { kind: Kind.Unary; operator: number; operand: Node }
interface Binary extends Node { kind: Kind.Binary; left: Node; operator: Node; right: Node }
interface Text extends Node { kind: Kind.Text; text: number; isLong: boolean }
const NodeObject = function (this: Node, kind: Kind, pos: number, end: number) { this.kind = kind; this.pos = pos; this.end = end; this.flags = 0; this.parent = undefined; } as unknown as new (kind: Kind, pos: number, end: number) => Node;
function base<T extends Node>(kind: T["kind"], pos = 0, end = 0): T { return new NodeObject(kind, pos, end) as T; }
function name(text: string): Name { const node = base<Name>(Kind.Name, 1, 2); node.text = text; return node; }
function unary(operator: number, operand: Node): Unary { const node = base<Unary>(Kind.Unary, 3, 4); node.operator = operator; node.operand = operand; operand.parent = node; return node; }
function binary(left: Node, operator: Node, right: Node): Binary { const node = base<Binary>(Kind.Binary, 5, 6); node.left = left; node.operator = operator; node.right = right; return node; }
function text(value: number, isLong: boolean): Text { const node = base<Text>(Kind.Text, 7, 8); node.text = value; node.isLong = isLong; return node; }

function has(object: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(object, key); }
function cloneNode<T extends Node>(node: T): T {
  const clone = base<T>(node.kind);
  clone.flags |= node.flags;
  for (const key in node) { if (has(clone, key) || !has(node, key)) continue; clone[key] = node[key]; }
  return clone;
}
function copyAll<T extends Node>(target: T, source: T): T { for (const key in source) target[key] = source[key]; return target; }
function copyLoose(target: Node, source: Node): Node { for (const p in source) (target as any)[p] = (source as any)[p]; return target; }
function copyOtherKey(target: Node, source: Node, rename: (key: string) => string): Node { for (const p in source) (target as any)[rename(p)] = (source as any)[p]; return target; }

function textLength(node: Name): number { return node.text.length; }
function textTwice(node: Text): number { return node.text * 2; }
function operatorOf(node: Unary): number { return node.operator + 1; }
function operatorKind(node: Binary): number { return node.operator.kind; }
function span(node: Node): number { return node.end - node.pos + node.flags; }
function parentKind(node: Node): number { return node.parent ? node.parent.kind : 0; }
function weigh(node: Node): number {
  switch (node.kind) {
    case Kind.Name: return textLength(node as Name) + span(node);
    case Kind.Unary: return operatorOf(node as Unary) + weigh((node as Unary).operand);
    case Kind.Binary: return operatorKind(node as Binary) + weigh((node as Binary).left) + weigh((node as Binary).right);
    case Kind.Text: return textTwice(node as Text) + ((node as Text).isLong ? 1 : 0);
  }
}
function show(node: Node) { let weight: unknown; try { weight = weigh(node); } catch (error) { weight = (error as Error).constructor.name; } return [node.kind, weight, span(node), parentKind(node), Object.keys(node).join()]; }

const trees: Node[] = [];
for (let i = 0; i < 200; i++) trees.push(binary(unary(i, name("n" + i)), name("+"), text(i, i % 2 === 0)));
function tally() { let t = 0; for (const tree of trees) t += weigh(tree) + weigh(cloneNode(tree)) + span(cloneNode((tree as Binary).left)); return t; }
for (let round = 0; round < 40; round++) tally();
say("tally", tally());

say("a clone of each kind", [name("abc"), unary(4, name("x")), binary(name("l"), name("-"), name("r")), text(9, true)].map(node => [show(node), show(cloneNode(node)), cloneNode(node) !== node]));
{ const n = name("flagged"); n.flags = 6; n.parent = trees[0]; const c = cloneNode(n); say("what the constructor stored is kept", [show(c), c.flags, c.pos, c.parent === undefined]); }
{ const n = name("more") as Name & { extra?: number[] }; n.extra = [1, 2]; const c = cloneNode(n); say("a name more goes along", [show(c), c.extra === n.extra]); }
// One kind into another: the names agree, the types do not.
{ const target = unary(1, name("u")); copyAll<Node>(target, binary(name("l"), name("*"), name("r"))); say("a Binary into a Unary", [target.kind, typeof (target as any).operator, Object.keys(target).join()]); let seen: unknown; try { seen = operatorOf(target); } catch (error) { seen = (error as Error).constructor.name; } say("its operator, read as a number", seen); }
{ const target = name("t"); copyLoose(target, text(5, true)); say("a Text into a Name", [target.kind, typeof (target as any).text, Object.keys(target).join()]); let seen: unknown; try { seen = textLength(target); } catch (error) { seen = (error as Error).constructor.name; } say("its text, read as a string", seen); }
{ const target = text(1, false); copyLoose(target, name("word")); let seen: unknown = textTwice(target); say("a Name into a Text", [target.kind, seen !== seen ? "#NaN" : seen, (target as any).isLong]); }
{ const target = binary(name("a"), name("b"), name("c")); copyLoose(target, unary(8, name("z"))); let seen: unknown; try { seen = operatorKind(target); } catch (error) { seen = (error as Error).constructor.name; } say("a Unary into a Binary", [target.kind, seen, Object.keys(target).join()]); }
// Two keys: no relation at all.
{ const target = name("k"); copyOtherKey(target, text(3, true), key => key === "text" ? "pos" : key === "isLong" ? "flags" : key === "pos" ? "text" : key); say("under another key", [typeof (target as any).text, target.pos, (target as any).flags, span(target)]); }
// What a for-in also finds, and what it does not.
{ const proto = { inherited: 1 }; const source = Object.setPrototypeOf(name("p"), proto) as Name; const c = copyLoose(name("q"), source); say("a name from above the source", [Object.keys(c).join(), (c as any).inherited]); }
{ const source = name("g"); Object.defineProperty(source, "text", { get() { return "got"; }, enumerable: true, configurable: true }); const c = cloneNode(source); say("a getter in the source", [show(c), Object.getOwnPropertyDescriptor(c, "text")]); }
{ const source = name("h"); Object.defineProperty(source, "text", { value: "hidden", enumerable: false, configurable: true, writable: true }); const c = cloneNode(source); let seen: unknown; try { seen = textLength(c); } catch (error) { seen = (error as Error).constructor.name; } say("a member that is not listed", [Object.keys(c).join(), seen]); }
{ const target = Object.freeze(name("f")); let seen: unknown; try { copyLoose(target, name("other")); seen = "stored"; } catch (error) { seen = (error as Error).constructor.name; } say("into a frozen node", [seen, textLength(target)]); }
{ const source = unary(2, name("d")); delete (source as any).operator; const c = cloneNode(source); let seen: unknown = operatorOf(c); say("a member that the source has lost", [Object.keys(c).join(), seen !== seen ? "#NaN" : seen]); }
say("the others are as they were", tally());
console.log(lines.join("\n"));
