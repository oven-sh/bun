// Objects of a class meet objects of many other kinds in one array, which reads their late references.
class Node { constructor(x) { this.x = x; } }
function link(a, b) { a.parent = b; }
const nodes = []; for (let i = 0; i < 8; i++) nodes.push(new Node(i + 1));
for (let i = 0; i < 7; i++) link(nodes[i], nodes[(i + 3) % 8]);
const others = [...nodes, { a: 1 }, { b: 2, c: 3 }, { d: 1, parent: { x: 30 } }, { f: 1 }, { g: 1, h: 2 }, new Map(), /x/, [1], () => 1];
others[12].parent = { x: 50, late: 1 }; others[16].parent = nodes[4];
let t = 0;
for (let k = 0; k < 400; k++) for (let i = 0; i < others.length; i++) { const o = others[i], p = o.parent; if (p) { t = (t + p.x) | 0; p.seen = (p.seen | 0) + 1; } }
console.log(t, nodes.map(n => (n.parent ? n.parent.x : "-") + ":" + n.seen).join(" "), others[12].parent.seen);
