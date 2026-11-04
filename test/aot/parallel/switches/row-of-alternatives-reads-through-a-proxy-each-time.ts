// a row of `||` reads `node.kind` in each alternative, and a Proxy of an object of the class goes in beside the objects themselves: the trap runs once for each read that is written, and answers differently each time
class Plain { kind: number; constructor(kind: number) { this.kind = kind; } }
function isKind(node: Plain) { return node.kind === 1 || node.kind === 4 || node.kind === 9; }
let trapped = 0;
function deed() { return new Proxy(new Plain(4), { get() { trapped++; return trapped % 3 === 2 ? 4 : 0; } }); }
let out = "";
for (let kind = 0; kind < 11; kind++) out += String(isKind(new Plain(kind))) + " ";
console.log(out);
console.log(String(isKind(deed())), String(trapped));
let count = 0;
for (let turn = 0; turn < 300; turn++) if (isKind(turn % 4 ? new Plain(turn % 11) : deed())) count++;
console.log(String(count), String(trapped));
