// The shape of TypeScript's node factories: one constructor function, objects born in a callee and completed in the caller.
function Node(kind, pos, end) {
  this.pos = pos;
  this.end = end;
  this.kind = kind;
  this.id = 0;
  this.flags = 0;
  this.transformFlags = 0;
  this.parent = undefined;
  this.original = undefined;
}
var NodeConstructor;
var objectAllocator = { getNodeConstructor: function () { return Node; } };
var baseFactory = {
  createBaseNode: function (kind) {
    return new (NodeConstructor || (NodeConstructor = objectAllocator.getNodeConstructor()))(kind, -1, -1);
  },
};
function createBaseNode(kind) { return baseFactory.createBaseNode(kind); }
function createBaseDeclaration(kind) {
  var node = createBaseNode(kind);
  node.symbol = undefined;
  node.localSymbol = undefined;
  return node;
}
function createBinaryExpression(left, operatorToken, right) {
  var node = createBaseDeclaration(1);
  node.left = left;
  node.operatorToken = operatorToken;
  node.right = right;
  node.transformFlags |= left.transformFlags | right.transformFlags;
  node.jsDoc = undefined;
  return node;
}
function createNumericLiteral(text) {
  var node = createBaseNode(2);
  node.text = text;
  node.numericLiteralFlags = 0;
  return node;
}
function createConditional(condition, whenTrue, whenFalse) {
  var node = createBaseNode(3);
  node.condition = condition;
  node.whenTrue = whenTrue;
  node.whenFalse = whenFalse;
  node.flowNodeWhenTrue = undefined;
  node.flowNodeWhenFalse = undefined;
  return node;
}
function sum(node) {
  switch (node.kind) {
    case 1: return sum(node.left) + sum(node.right);
    case 2: return node.text.length;
    default: return sum(node.condition) + sum(node.whenTrue) + sum(node.whenFalse);
  }
}
function build(depth) {
  if (depth === 0) return createNumericLiteral("12");
  if (depth % 3 === 0) return createConditional(build(depth - 1), build(depth - 1), createNumericLiteral("7"));
  return createBinaryExpression(build(depth - 1), createNumericLiteral("+"), build(depth - 1));
}
var rounds = Number(process.argv[2] || 3);
var total = 0;
for (var round = 0; round < rounds; round++) total += sum(build(12));
console.log(total);
