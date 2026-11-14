// a tree --> a string
exports.print = function print(node) {
  if (node instanceof Pair) return "(" + print(node.left) + print(node.right) + ")";
  return node.value.replace(/^x$/, "<!--").toUpperCase();
};
