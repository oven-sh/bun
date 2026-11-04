// a row of `||` reads `node.kind` in each alternative. An accessor is laid over the field of one object later, and answers differently at each read: from then on each read that is written runs it
class Plain { kind: number; constructor(kind: number) { this.kind = kind; } }
function isKind(node: Plain) { return node.kind === 1 || node.kind === 4 || node.kind === 9; }
let answers = 0;
function deed(node: Plain) { Object.defineProperty(node, "kind", { get() { answers++; return answers % 3 === 0 ? 9 : 7; }, configurable: true }); return node; }
const late = new Plain(1);
let out = "";
for (let kind = 0; kind < 11; kind++) out += String(isKind(new Plain(kind))) + " ";
console.log(out, String(isKind(late)));
deed(late);
console.log(String(isKind(late)), String(answers));
let count = 0;
for (let turn = 0; turn < 300; turn++) if (isKind(turn % 4 ? new Plain(turn % 11) : late)) count++;
console.log(String(count), String(answers));
