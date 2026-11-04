// the keys of an object whose allocation lists the first stores of its constructor function are seen by every built-in that lists keys, with all arguments, with too few and with too many
function Node(kind, pos, end) { this.pos = pos; this.end = end; this.kind = kind; this.id = 0; this.flags = 0; this.parent = undefined; }
function Backwards(a, b) { this.z = a; this.y = b; this.x = 0; this.w = "w"; }
function all(kind) { return new Node(kind, -1, kind + 1); }
function few(kind) { return new Node(kind); }
function none() { return new Node(); }
function many(kind) { return new Node(kind, 1, 2, 3, 4); }
function backwards(a) { return new Backwards(a, a); }
function deed(node) { let names = ""; for (const name in node) names += name + ","; return names + " " + Object.keys(node).join() + " " + JSON.stringify(node) + " " + Reflect.ownKeys(node).join() + " " + Object.keys({ ...node, last: 1 }).join() + " " + Object.getOwnPropertyNames(node).join(); }
console.log(deed(all(1)));
console.log(deed(few(1)));
console.log(deed(none()));
console.log(deed(many(1)));
console.log(deed(backwards(1)));
for (let turn = 0; turn < 300; turn++) { all(turn); few(turn); none(); many(turn); backwards(turn); }
console.log(deed(all(2)), deed(few(2)), deed(none()), deed(many(2)), deed(backwards(2)));
const later = all(3);
later.extra = 1;
delete later.pos;
later.pos = "again";
console.log(deed(later));
