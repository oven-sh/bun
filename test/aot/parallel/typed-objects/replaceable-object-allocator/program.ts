enum SyntaxKind { Unknown, Identifier, NumericLiteral, CallExpression, CommaToken }
type Mutable<T extends object> = { -readonly [K in keyof T]: T[K] }
interface AstNode { readonly kind: SyntaxKind; readonly pos: number; readonly end: number; flags: number; getWidth?(): number; getKindName?(): string }
interface Identifier extends AstNode { readonly kind: SyntaxKind.Identifier; readonly text: string }
interface NumericLiteral extends AstNode { readonly kind: SyntaxKind.NumericLiteral; readonly value: number }
interface CallExpression extends AstNode { readonly kind: SyntaxKind.CallExpression; readonly expression: AstNode; readonly arguments: AstNode[]; readonly separators: AstNode[] }
type NodeConstructor = new (kind: SyntaxKind, pos: number, end: number) => AstNode
interface ObjectAllocator { getNodeConstructor(): NodeConstructor; getTokenConstructor(): NodeConstructor; getIdentifierConstructor(): NodeConstructor }

function AstNode(this: Mutable<AstNode>, kind: SyntaxKind, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.flags = 0 }
function TokenFunction(this: Mutable<AstNode>, kind: SyntaxKind, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.flags = 1 }
function IdentifierFunction(this: Mutable<AstNode>, kind: SyntaxKind, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.flags = 2 }
class NodeObject implements AstNode {
  kind: SyntaxKind; pos: number; end: number; flags: number
  constructor(kind: SyntaxKind, pos: number, end: number) { this.flags = 8; this.kind = kind; this.pos = pos; this.end = end }
  getWidth(): number { return this.end - this.pos }
  getKindName(): string { return "class " + SyntaxKind[this.kind] }
}
class IdentifierObject extends NodeObject {
  declare readonly kind: SyntaxKind.Identifier
  text!: string
  override getKindName(): string { return "name " + this.text }
}
const defaults: ObjectAllocator = { getNodeConstructor: () => AstNode as any, getTokenConstructor: () => TokenFunction as any, getIdentifierConstructor: () => IdentifierFunction as any }
const objectAllocator: ObjectAllocator = { ...defaults }
const objectAllocatorPatchers: ((allocator: ObjectAllocator) => void)[] = []
function addObjectAllocatorPatcher(fn: (allocator: ObjectAllocator) => void) { objectAllocatorPatchers.push(fn); fn(objectAllocator) }
function setObjectAllocator(alloc: Partial<ObjectAllocator>) { Object.assign(objectAllocator, alloc); objectAllocatorPatchers.forEach(fn => fn(objectAllocator)) }

let CachedIdentifier: NodeConstructor | undefined, StaleToken: NodeConstructor | undefined, patches = 0
addObjectAllocatorPatcher(() => { CachedIdentifier = undefined; patches++ })
function createBaseNode<T extends AstNode>(kind: T["kind"], pos: number, end: number) { return new (objectAllocator.getNodeConstructor())(kind, pos, end) as Mutable<T> }
function createToken(kind: SyntaxKind, pos: number): AstNode { return new (StaleToken ||= objectAllocator.getTokenConstructor())(kind, pos, pos + 1) }
function createIdentifier(text: string, pos: number): Identifier {
  const node = new (CachedIdentifier ||= objectAllocator.getIdentifierConstructor())(SyntaxKind.Identifier, pos, pos + text.length) as Mutable<Identifier>
  node.text = text
  return node
}
function createNumericLiteral(value: number, pos: number): NumericLiteral {
  const node = createBaseNode<NumericLiteral>(SyntaxKind.NumericLiteral, pos, pos + String(value).length)
  node.value = value
  return node
}
function createCall(expression: AstNode, args: AstNode[]): CallExpression {
  const node = createBaseNode<CallExpression>(SyntaxKind.CallExpression, expression.pos, args.length ? args[args.length - 1].end + 1 : expression.end + 2)
  node.expression = expression
  node.arguments = args
  node.separators = args.slice(1).map(a => createToken(SyntaxKind.CommaToken, a.pos - 1))
  node.flags |= 16
  return node
}
function sample(): CallExpression { return createCall(createIdentifier("fn", 0), [createNumericLiteral(12.5, 3), createIdentifier("x", 8), createNumericLiteral(7, 10)]) }
function describe(n: AstNode): string {
  return (n as any).constructor.name + "{" + Object.keys(n).join() + "}" + n.flags + "/" + (n.getWidth ? n.getWidth() : "w" + (n.end - n.pos)) + "/" + (n.getKindName?.() ?? "none") + "/" + ("getWidth" in n)
}
function textOf(n: AstNode): string {
  switch (n.kind) {
    case SyntaxKind.Identifier: return (n as Identifier).text
    case SyntaxKind.NumericLiteral: return String((n as NumericLiteral).value)
    case SyntaxKind.CallExpression: { const c = n as CallExpression; return textOf(c.expression) + "(" + c.arguments.map(textOf).join() + ")" + c.separators.length }
    default: return SyntaxKind[n.kind]
  }
}
function report(label: string, c: CallExpression) { console.log(label, textOf(c), describe(c), describe(c.expression), c.arguments.map(describe).join(" "), describe(c.separators[0]), patches) }

const byFunctions = sample()
report("functions", byFunctions)
setObjectAllocator({ getNodeConstructor: () => NodeObject, getIdentifierConstructor: () => IdentifierObject, getTokenConstructor: () => NodeObject })
const byClasses = sample()
report("classes", byClasses)
report("functions again", byFunctions)
console.log(byClasses instanceof NodeObject, byClasses.expression instanceof IdentifierObject, byClasses.separators[0] instanceof NodeObject, byFunctions instanceof NodeObject, byFunctions instanceof (AstNode as any))

// A constructor that returns an object it has created itself.
let counted = 0
function Counting(this: unknown, kind: SyntaxKind, pos: number, end: number) { counted++; return counted % 2 ? new NodeObject(kind, pos, end) : { end, pos, kind, flags: 32, counted } }
setObjectAllocator({ getNodeConstructor: () => Counting as any })
const byCounting = [sample(), sample()]
report("counting 1", byCounting[0]); report("counting 2", byCounting[1])
console.log(counted, byCounting.map(c => c instanceof (Counting as any)).join(), byCounting.map(c => c.arguments.map(a => Object.getPrototypeOf(a) === Object.prototype).join("")).join())
setObjectAllocator(defaults)
report("defaults", sample())

const allocators: Partial<ObjectAllocator>[] = [defaults, { getNodeConstructor: () => NodeObject }, { getIdentifierConstructor: () => IdentifierObject }, { getNodeConstructor: () => Counting as any }]
let widths = 0, flagBits = 0
const shapes = new Set<string>()
for (let i = 0; i < 6000; i++) {
  setObjectAllocator(allocators[i % allocators.length])
  const c = sample()
  for (const n of [c, c.expression, ...c.arguments, ...c.separators]) { widths += n.getWidth ? n.getWidth() : n.end - n.pos; flagBits |= n.flags }
  shapes.add((c as any).constructor.name + ":" + (c.expression as any).constructor.name + ":" + Object.keys(c).join(""))
  widths += (c.arguments[0] as NumericLiteral).value + (c.expression as Identifier).text.length
}
console.log(widths, flagBits, patches, counted, [...shapes].sort().join(" "))
