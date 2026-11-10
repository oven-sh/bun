// a row of `||` and a row of `&&` read `node.kind` in each alternative. Objects whose `kind` is a field go in beside objects of a class whose `kind` is a getter that counts and changes its answer: each read that is written runs
class Plain { kind: number; constructor(kind: number) { this.kind = kind; } }
let reads = 0;
class Counting { get kind() { reads++; return reads % 3 === 0 ? 9 : 2; } }
function isKind(node: { kind: number }) { return node.kind === 1 || node.kind === 4 || node.kind === 9; }
function isOther(node: { kind: number }) { return node.kind !== 1 && node.kind !== 4 && node.kind !== 9; }
function deed(node: { kind: number }) { return String(isKind(node)) + "/" + String(isOther(node)) + "/" + reads; }
let out = "";
for (let kind = 0; kind < 11; kind++) out += deed(new Plain(kind)) + " ";
console.log(out);
console.log(deed(new Counting()), deed(new Counting()));
let count = 0;
for (let turn = 0; turn < 400; turn++) if (isKind(turn % 5 ? new Plain(turn % 11) : new Counting())) count++;
console.log(String(count), String(reads));
console.log(deed(new Counting()), deed(new Plain(9)));
