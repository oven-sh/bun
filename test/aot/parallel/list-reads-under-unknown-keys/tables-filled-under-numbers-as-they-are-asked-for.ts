// tables that are filled as they are asked for, under what a call gives, a parameter, a field: as a checker keeps its links
class Links { flags = 0; constructor(public of: number) {} }
class Node { id = 0; constructor(public kind: number) {} }
let nextId = 1;
const nodeLinks: Links[] = [];
const byKind: (Links | undefined)[] = [];
const names: string[] = [];
function idOf(node: Node): number { if (!node.id) { node.id = nextId; nextId++; } return node.id; }
function linksOf(node: Node): Links { const id = idOf(node); return nodeLinks[id] || (nodeLinks[id] = new Links(id)); }
function linksOfKind(node: Node): Links { return byKind[node.kind] ??= new Links(-node.kind); }
function nameOf(kind: any): string { return names[kind] || (names[kind] = "kind " + String(kind)); }
const nodes: Node[] = [];
for (let i = 0; i < 300; i++) nodes.push(new Node(i % 7));
let sum = 0;
for (let round = 0; round < 5; round++) for (const node of nodes) { const links = linksOf(node); links.flags += round; sum += links.flags + links.of + linksOfKind(node).of; }
console.log(sum, nodeLinks.length, byKind.length, nodeLinks[0], nodeLinks[300].of);
console.log(nameOf(1), nameOf("1"), nameOf(2.5), nameOf(-1), nameOf("x"), nameOf(1), names.length, Object.keys(names).join());
