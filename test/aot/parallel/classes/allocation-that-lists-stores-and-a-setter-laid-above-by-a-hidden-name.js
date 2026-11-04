// a setter is laid above the objects of a constructor function, under a name and by a built-in that only JSON.parse knows, between two constructions
const hidden = JSON.parse('{"define":"defineProperty","name":"pos"}');
let log = "";
function Node(kind, pos, end) { this.pos = pos; this.end = end; this.kind = kind; this.id = 0; this.flags = 0; this.parent = undefined; }
function make(kind) { return new Node(kind, -1, kind + 1); }
function show(node) { const text = Object.keys(node).join() + " " + JSON.stringify(node) + log; log = ""; return text; }
function deed() { Reflect[hidden.define](Node.prototype, hidden.name, { set(value) { log += " set " + value; }, configurable: true }); }
console.log(show(make(0)));
for (let turn = 1; turn < 300; turn++) make(turn);
console.log(show(make(300)));
deed();
console.log(show(make(301)));
for (let turn = 0; turn < 3; turn++) console.log(show(make(turn)));
delete Node.prototype[hidden.name];
console.log(show(make(302)));
