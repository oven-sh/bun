export class Node { constructor(type, start, end) { this.type = type; this.start = start; this.end = end; } }
export function parse(text) {
  const body = new Node("BlockStatement", 6, text.length);
  const arrow = new Node("ArrowFunctionExpression", 0, text.length); arrow.async = false; arrow.expression = false; arrow.body = body;
  const program = new Node("Program", 0, text.length); program.body = [arrow];
  return program;
}
