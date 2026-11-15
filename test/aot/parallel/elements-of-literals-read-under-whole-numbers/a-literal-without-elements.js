class Node { constructor(kind) { this.kind = kind | 0; } }
const table = { name: "no elements" };
function at(node) { return table[node.kind | 0]; }
const lines = [];
for (let i = 0; i < 120; i++) {
  if (i === 60) table[2] = "the first element";
  const said = [0, 2, 3].map(kind => String(at(new Node(kind)))).join(" . ");
  if (i < 1 || (i >= 59 && i < 62) || i === 119) lines.push(i + ": " + said);
}
console.log(lines.join("\n"));
