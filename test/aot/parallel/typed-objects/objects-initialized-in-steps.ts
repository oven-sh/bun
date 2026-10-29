// Objects that get their fields in several steps: constructor functions with a typed `this`, generic base factories, and factories that cast and then store.
enum SyntaxKind { Unknown, NumericLiteral, Identifier, PlusToken, AsteriskToken, BinaryExpression, ParenthesizedExpression }
enum NodeFlags { None = 0, Synthesized = 1 << 0, HasError = 1 << 1 }
enum TransformFlags { None = 0, ContainsNumber = 1 << 0, ContainsName = 1 << 1, ContainsBinary = 1 << 2, ContainsParens = 1 << 3 }
type Mutable<T extends object> = { -readonly [K in keyof T]: T[K] }
interface AstNode {
  readonly kind: SyntaxKind; readonly flags: NodeFlags; readonly pos: number; readonly end: number
  id: number; transformFlags: TransformFlags; readonly parent: AstNode | undefined; readonly original: AstNode | undefined
}
interface Expression extends AstNode { _expressionBrand: any }
interface NumericLiteral extends Expression { readonly kind: SyntaxKind.NumericLiteral; readonly text: string; readonly value: number }
interface Identifier extends Expression { readonly kind: SyntaxKind.Identifier; readonly escapedText: string; readonly originalKeywordKind?: SyntaxKind }
interface Token<K extends SyntaxKind> extends AstNode { readonly kind: K }
type BinaryOperator = SyntaxKind.PlusToken | SyntaxKind.AsteriskToken
interface BinaryExpression extends Expression { readonly kind: SyntaxKind.BinaryExpression; readonly left: Expression; readonly operatorToken: Token<BinaryOperator>; readonly right: Expression }
interface ParenthesizedExpression extends Expression { readonly kind: SyntaxKind.ParenthesizedExpression; readonly expression: Expression }

function AstNode(this: Mutable<AstNode>, kind: SyntaxKind, pos: number, end: number) {
  this.pos = pos; this.end = end; this.kind = kind; this.id = 0
  this.flags = NodeFlags.None; this.transformFlags = TransformFlags.None
  this.parent = undefined; this.original = undefined
}
function TokenObject(this: Mutable<AstNode>, kind: SyntaxKind, pos: number, end: number) {
  this.kind = kind; this.pos = pos; this.end = end; this.id = 0
  this.flags = NodeFlags.None; this.transformFlags = TransformFlags.None; this.parent = undefined
}
function IdentifierObject(this: Mutable<AstNode>, kind: SyntaxKind, pos: number, end: number) {
  this.pos = pos; this.end = end; this.kind = kind; this.id = 0
  this.flags = NodeFlags.Synthesized; this.transformFlags = TransformFlags.ContainsName
  this.parent = undefined; this.original = undefined
}
type NodeConstructor = new (kind: SyntaxKind, pos: number, end: number) => AstNode
const objectAllocator = {
  getNodeConstructor: (): NodeConstructor => AstNode as any,
  getTokenConstructor: (): NodeConstructor => TokenObject as any,
  getIdentifierConstructor: (): NodeConstructor => IdentifierObject as any,
}
function createBaseNodeFactory() {
  let NodeCtor: NodeConstructor, TokenCtor: NodeConstructor, IdentifierCtor: NodeConstructor
  return {
    createBaseNode: (kind: SyntaxKind) => new (NodeCtor || (NodeCtor = objectAllocator.getNodeConstructor()))(kind, -1, -1),
    createBaseTokenNode: (kind: SyntaxKind) => new (TokenCtor || (TokenCtor = objectAllocator.getTokenConstructor()))(kind, -1, -1),
    createBaseIdentifierNode: (kind: SyntaxKind) => new (IdentifierCtor || (IdentifierCtor = objectAllocator.getIdentifierConstructor()))(kind, -1, -1),
  }
}
const baseFactory = createBaseNodeFactory()
function createBaseNode<T extends AstNode>(kind: T["kind"]) { return baseFactory.createBaseNode(kind) as Mutable<T> }
function createBaseToken<T extends AstNode>(kind: T["kind"]) { return baseFactory.createBaseTokenNode(kind) as Mutable<T> }
function propagateChildFlags(child: AstNode | undefined): TransformFlags { return child ? child.transformFlags : TransformFlags.None }
function createToken<K extends SyntaxKind>(kind: K): Token<K> { return createBaseToken<Token<K>>(kind) }
function asToken<K extends SyntaxKind>(value: K | Token<K>): Token<K> { return typeof value === "number" ? createToken(value) : value }
function createNumericLiteral(value: number): NumericLiteral {
  const node = createBaseNode<NumericLiteral>(SyntaxKind.NumericLiteral)
  node.text = String(value)
  node.value = value
  node.transformFlags |= TransformFlags.ContainsNumber
  return node
}
function createIdentifier(text: string, keyword?: SyntaxKind): Identifier {
  const node = baseFactory.createBaseIdentifierNode(SyntaxKind.Identifier) as Mutable<Identifier>
  node.escapedText = text
  if (keyword !== undefined) node.originalKeywordKind = keyword
  if (text.length === 0) node.flags |= NodeFlags.HasError
  return node
}
function createBinaryExpression(left: Expression, operator: BinaryOperator | Token<BinaryOperator>, right: Expression): BinaryExpression {
  const node = createBaseNode<BinaryExpression>(SyntaxKind.BinaryExpression)
  node.left = left
  node.operatorToken = asToken(operator)
  node.right = right
  node.transformFlags |= propagateChildFlags(node.left) | propagateChildFlags(node.operatorToken) | propagateChildFlags(node.right) | TransformFlags.ContainsBinary
  return node
}
function createParenthesizedExpression(expression: Expression): ParenthesizedExpression {
  const node = createBaseNode<ParenthesizedExpression>(SyntaxKind.ParenthesizedExpression)
  node.expression = expression
  node.transformFlags = propagateChildFlags(expression) | TransformFlags.ContainsParens
  return node
}
function evaluate(node: Expression): number {
  switch (node.kind) {
    case SyntaxKind.NumericLiteral: return (node as NumericLiteral).value
    case SyntaxKind.Identifier: return (node as Identifier).escapedText.length
    case SyntaxKind.ParenthesizedExpression: return evaluate((node as ParenthesizedExpression).expression)
    case SyntaxKind.BinaryExpression: {
      const binary = node as BinaryExpression, l = evaluate(binary.left), r = evaluate(binary.right)
      return binary.operatorToken.kind === SyntaxKind.PlusToken ? l + r : l * r
    }
    default: return NaN
  }
}
function show(node: AstNode): string { return Object.keys(node).join() + " " + JSON.stringify(node) }

const one = createNumericLiteral(1), abc = createIdentifier("abc"), star = createToken(SyntaxKind.AsteriskToken)
console.log(show(one))
console.log(show(abc))
console.log(show(createIdentifier("", SyntaxKind.PlusToken)))
console.log(show(star))
const product = createBinaryExpression(createNumericLiteral(2.5), star, abc)
const sum = createBinaryExpression(one, SyntaxKind.PlusToken, createParenthesizedExpression(product))
console.log(show(sum))
console.log(evaluate(sum), sum.transformFlags, sum.left === one, product.operatorToken === star, sum.operatorToken.kind, sum.kind, sum.pos, sum.end, sum.id, sum.flags)
console.log("left" in sum, "left" in one, "text" in one, "value" in abc, "originalKeywordKind" in abc, abc.originalKeywordKind, "_expressionBrand" in sum)
console.log("original" in sum, sum.original, "original" in star, star.original, one.parent, "parent" in one)
console.log(sum instanceof (AstNode as any), star instanceof (AstNode as any), star instanceof (TokenObject as any), Object.getPrototypeOf(abc) === IdentifierObject.prototype, (sum as any).constructor === AstNode)
function chain(n: number): Expression {
  let e: Expression = createNumericLiteral(0)
  for (let i = 1; i <= n; i++) e = createBinaryExpression(e, i % 3 ? SyntaxKind.PlusToken : star, i % 4 ? createNumericLiteral(i) : createParenthesizedExpression(createIdentifier("n" + i)))
  return e
}
console.log(evaluate(chain(1)), evaluate(chain(7)), evaluate(chain(30)), chain(30).transformFlags, Object.keys(chain(2)).join())
let flagsSeen = 0, kindsSeen = 0, textLength = 0
for (let i = 0; i < 20000; i++) {
  const node: AstNode = i % 3 === 0 ? createNumericLiteral(i / 2) : i % 3 === 1 ? createIdentifier("v" + (i & 7)) : createToken(SyntaxKind.PlusToken)
  flagsSeen += node.transformFlags + node.flags; kindsSeen += node.kind
  if (node.kind === SyntaxKind.NumericLiteral) textLength += (node as NumericLiteral).text.length + (node as NumericLiteral).value
}
console.log(flagsSeen, kindsSeen, textLength)
