interface Branch { kind: "branch"; below: Leaf | Branch | null; weight: number }
interface Leaf { kind: "leaf"; below: null; weight: number }

function grow(weight: number): Branch {
  return { kind: "branch", below: { kind: "leaf", below: null, weight: weight + 1 }, weight };
}
function growLate(weight: number): Branch {
  return { below: { weight: weight + 2, below: null, kind: "leaf" }, weight, kind: "branch" };
}
function tell(node: Branch | Leaf | null): string {
  return node === null ? "." : node.kind + node.weight + tell(node.below);
}
let text = "";
for (let turn = 0; turn < 300; turn++) text = tell(grow(turn)) + " " + tell(growLate(turn)) + " " + tell({ kind: "branch", below: grow(turn), weight: -turn });
console.log(text);
