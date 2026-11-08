class Node { constructor(kind) { this.kind = kind | 0; } }
const table = { name: "a table", [2]: "two", size: 3, [5]: "five", 7: "seven" };
function at(node) { return table[node.kind | 0]; }
const lines = [];
for (let i = 0; i < 120; i++) {
  if (i === 60) { table.more = "later"; table[6] = "six"; delete table.size; }
  const said = [1, 2, 5, 6, 7, 8].map(kind => String(at(new Node(kind)))).join(" . ") + " | " + Object.keys(table).join();
  if (i < 1 || (i >= 59 && i < 62) || i === 119) lines.push(i + ": " + said);
}
console.log(lines.join("\n"));
