export function simple(node, visitors) {
  const visit = visitors[node.type]; if (visit) visit(node);
  if (Array.isArray(node.body)) for (const child of node.body) simple(child, visitors); else if (node.body) simple(node.body, visitors);
}
export function each(node, visit) { visit(node); if (Array.isArray(node.body)) for (const child of node.body) each(child, visit); else if (node.body) each(node.body, visit); }
export function later(node) { return Promise.resolve(node); }
export class Walker { constructor(visitors) { this.visitors = visitors; } run(node) { simple(node, this.visitors); } }
