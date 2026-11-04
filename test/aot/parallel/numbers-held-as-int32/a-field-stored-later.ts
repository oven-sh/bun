// a field stored later
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
interface Node { kind: number; id?: number; }
class Leaf implements Node { kind: number; id?: number; constructor(kind: number) { this.kind = kind; } }
const links: string[] = []; let next = 1;
function idOf(node: Leaf) { if (!node.id) { node.id = next; next++; } return node.id; }
function linkOf(node: Leaf) { return links[node.id!] ??= "link " + node.id; }
const a = new Leaf(1), b = new Leaf(2), c = new Leaf(3); (globalThis as any).kept = [a, b, c];
idOf(a); idOf(b); c.id = hidden<number>("2.5");
console.log(linkOf(a), linkOf(b), linkOf(c), a.id, b.id, c.id, JSON.stringify([a, b, c]), links.length, Object.keys(links).join());
