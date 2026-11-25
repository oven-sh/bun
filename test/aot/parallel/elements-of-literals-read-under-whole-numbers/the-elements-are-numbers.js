class Node { constructor(kind) { this.kind = kind | 0; } }
const whole = { [0]: 10, [1]: 20, [3]: 40 };
const fractions = { [0]: 0.5, [1]: 1.5, [3]: 3.5 };
function read(table, node) { return table[node.kind | 0]; }
function wholeAt(node) { return whole[node.kind | 0]; }
function fractionAt(node) { return fractions[node.kind | 0]; }
const lines = [];
for (let i = 0; i < 120; i++) {
  if (i === 60) { whole[1] = "a text"; fractions[2] = null; }
  const said = [0, 1, 2, 3, 4].map(kind => String(wholeAt(new Node(kind))) + "|" + String(fractionAt(new Node(kind)))).join(" . ");
  if (i < 1 || (i >= 59 && i < 62) || i === 119) lines.push(i + ": " + said);
}
console.log(lines.join("\n"));
