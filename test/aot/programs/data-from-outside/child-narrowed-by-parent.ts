// A type guard on a parent node narrows the type of its child.
const enum Kind { Plus, OrEquals, AndEquals, Binary }
type BinaryOperator = Kind.Plus | Kind.OrEquals | Kind.AndEquals
type LogicalAssignmentOperator = Kind.OrEquals | Kind.AndEquals
interface Node { readonly kind: Kind }
interface Token<K extends Kind> extends Node { readonly kind: K }
interface BinaryExpression extends Node { readonly kind: Kind.Binary; readonly operatorToken: Token<BinaryOperator> }
interface AssignmentExpression<T extends Token<BinaryOperator>> extends BinaryExpression { readonly operatorToken: T }
function isLogicalAssignment(node: Node): node is AssignmentExpression<Token<LogicalAssignmentOperator>> { return node.kind === Kind.Binary && (node as BinaryExpression).operatorToken.kind !== Kind.Plus }
function transform(expression: AssignmentExpression<Token<LogicalAssignmentOperator>>) { const operator = expression.operatorToken; return operator.kind }
function createToken(kind: BinaryOperator): Token<BinaryOperator> { return { kind } }
function createBinary(operatorToken: Token<BinaryOperator>): BinaryExpression { return { kind: Kind.Binary, operatorToken } }
function attempt(label: string, f: () => unknown) { try { console.log(label + ":", String(f())) } catch (e) { console.log(label + ":", (e as Error).constructor.name, (e as Error).message.split("\n").join(" /")) } }
for (const kind of [Kind.OrEquals, Kind.Plus, Kind.AndEquals] as BinaryOperator[]) attempt("kind " + kind, () => { const node: Node = createBinary(createToken(kind)); return isLogicalAssignment(node) ? transform(node) : "no" })
export {};
