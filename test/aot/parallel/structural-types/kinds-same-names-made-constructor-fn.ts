// Kinds with the same names made by one constructor function.
const enum Kind { Expression = 1, Throw = 2, Return = 3, Identifier = 4, Block = 5 }
interface Node { kind: Kind; pos: number; end: number }
interface ExpressionStatement extends Node { kind: Kind.Expression; expression: Node; note?: string }
interface ThrowStatement extends Node { kind: Kind.Throw; expression: Node; note?: string }
interface ReturnStatement extends Node { kind: Kind.Return; expression: Node; note?: string }
interface Identifier extends Node { kind: Kind.Identifier; text: string }
interface Block extends Node { kind: Kind.Block; statements: Node[] }

function NodeObject(this: Node, kind: Kind, pos: number, end: number) {
  this.kind = kind;
  this.pos = pos;
  this.end = end;
}
const NodeConstructor = NodeObject as unknown as new (kind: Kind, pos: number, end: number) => Node;

function createIdentifier(text: string): Identifier {
  const node = new NodeConstructor(Kind.Identifier, 0, 0) as Identifier;
  node.text = text;
  return node;
}
function createExpressionStatement(expression: Node): ExpressionStatement {
  const node = new NodeConstructor(Kind.Expression, 0, 0) as ExpressionStatement;
  node.expression = expression;
  return node;
}
function createThrowStatement(expression: Node): ThrowStatement {
  const node = new NodeConstructor(Kind.Throw, 0, 0) as ThrowStatement;
  node.expression = expression;
  return node;
}
function createReturnStatement(expression: Node): ReturnStatement {
  const node = new NodeConstructor(Kind.Return, 0, 0) as ReturnStatement;
  node.expression = expression;
  return node;
}
function createBlock(statements: Node[]): Block {
  const node = new NodeConstructor(Kind.Block, 0, 0) as Block;
  node.statements = statements;
  return node;
}
function lengthOf(node: Node): number {
  switch (node.kind) {
    case Kind.Identifier: return (node as Identifier).text.length;
    case Kind.Expression: return 1 + lengthOf((node as ExpressionStatement).expression);
    case Kind.Throw: return 2 + lengthOf((node as ThrowStatement).expression);
    case Kind.Return: return 3 + lengthOf((node as ReturnStatement).expression);
    case Kind.Block: { let sum = 0; for (const statement of (node as Block).statements) sum += lengthOf(statement); return sum; }
  }
}
const statements: Node[] = [];
for (let i = 0; i < 3000; i++) {
  const name = createIdentifier("n" + i);
  statements.push(i % 3 === 0 ? createExpressionStatement(name) : i % 3 === 1 ? createThrowStatement(name) : createReturnStatement(name));
}
console.log(lengthOf(createBlock(statements)));
