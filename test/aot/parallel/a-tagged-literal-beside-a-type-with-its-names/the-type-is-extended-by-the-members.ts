interface Range { pos: number; end: number }
interface A extends Range { kind: 0; a: number }
interface B extends Range { kind: 1; b: string }
type Node = A | B;
function width(r: Range): number { return r.end - r.pos; }
function show(n: Node): string { return (n.kind === 0 ? n.a + 1 : n.b + "!") + ":" + width(n); }
const nodes: Node[] = [{ kind: 0, a: 1, pos: 0, end: 4 }, { kind: 1, b: "x", pos: 4, end: 9 }];
let out = ""; for (let i = 0; i < 4; i++) out += show(nodes[i % 2]) + ",";
console.log(out, width({ pos: 1, end: 2 }));
