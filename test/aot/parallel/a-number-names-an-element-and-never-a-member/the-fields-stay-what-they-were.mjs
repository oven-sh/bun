class Node { constructor(kind, pos) { this.kind = kind; this.pos = pos; } }
const nodes = [new Node(1, 2), new Node(3, 4)];
function each(list, f) { for (let i = 0; i < list.length; i++) f(list[i]); }
function first(h) { return h[0]; }
let sum = 0;
each(nodes, n => { sum += n.kind + n.pos; });
console.log(sum, typeof first(nodes[0]), typeof first(nodes), Object.getPrototypeOf(nodes[0]) === Node.prototype, nodes[0].constructor === Node);
