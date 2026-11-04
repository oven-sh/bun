// `case 1: case 4: case 9:` share a body, which reads the local, the field and the holder again, and a case of its own stands beside them.
type Leaf = { kind: 1 | 4 | 9; text: string };
type Pair = { kind: 2; left: number; right: number };
function describe(node: Leaf | Pair): string {
  switch (node.kind) {
    case 1: case 4: case 9: return node.kind + ":" + node.text;
    case 2: return "pair " + (node.left + node.right);
  }
}
function classify(kind: number): string {
  switch (kind) {
    case 1: case 4: case 9: kind += 100; return "listed " + kind;
    case 2: return "two";
    default: return "other " + kind;
  }
}
const nodes: (Leaf | Pair)[] = [{ kind: 1, text: "a" }, { kind: 2, left: 3, right: 4 }, { kind: 9, text: "c" }, { kind: 4, text: "b" }];
for (let turn = 0; turn < 3; turn++) for (let i = 0; i < nodes.length; i++) console.log(describe(nodes[i]));
const kinds: any[] = [0, 1, 2, 4, 9, 10, 65, 73, -55, 4.5, 9.0, -0, NaN, "4", null, undefined];
for (let i = 0; i < kinds.length; i++) console.log(classify(kinds[i]));
