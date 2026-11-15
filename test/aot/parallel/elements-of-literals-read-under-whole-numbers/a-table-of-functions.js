class Node { constructor(kind) { this.kind = kind | 0; } }
const table = {
  [3]: function three(node) { return "three " + node.kind; },
  [4]: function four(node) { return "four " + node.kind; },
  [7]: function seven(node) { return "seven " + node.kind; },
  [12]: function twelve(node) { return "twelve " + node.kind; },
};
function visit(node) {
  if (node === undefined || node.kind <= 1) return "none";
  const found = table[node.kind | 0];
  return found === undefined ? "nothing under " + node.kind : typeof found === "function" ? found(node) : "a value: " + String(found);
}
const lines = [];
const kinds = [3, 4, 5, 7, 12, 13, 2, 40];
for (let i = 0; i < 120; i++) {
  if (i === 60) {
    lines.push("half");
  }
  const said = kinds.map(kind => visit(new Node(kind))).join(" . ");
  if (i < 1 || (i >= 59 && i < 62) || i === 119) lines.push(i + ": " + said);
}
console.log(lines.join("\n"));
