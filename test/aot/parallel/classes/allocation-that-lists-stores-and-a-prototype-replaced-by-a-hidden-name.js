// `prototype` of a constructor function is replaced, under a name that only JSON.parse knows, by an object with a setter for a name that the head of the body stores
const hidden = JSON.parse('{"name":"prototype"}');
let log = "";
function Node(kind, pos, end) { this.pos = pos; this.end = end; this.kind = kind; this.id = 0; }
function make(kind) { return new Node(kind, -1, kind + 1); }
function isNode(node) { try { return node instanceof Node; } catch (error) { return error.constructor.name; } }
function show(node) { const text = Object.keys(node).join() + " " + JSON.stringify(node) + " " + isNode(node) + " " + String(node.marked) + log; log = ""; return text; }
function deed(above) { Node[hidden.name] = above; }
const former = Node.prototype;
console.log(show(make(0)));
for (let turn = 1; turn < 300; turn++) make(turn);
deed({ marked: true, set end(value) { log += " end " + value; } });
console.log(show(make(1)));
for (let turn = 0; turn < 3; turn++) console.log(show(make(turn)));
deed(5);
console.log(show(make(2)), Object.getPrototypeOf(make(2)) === Object.prototype);
deed(former);
console.log(show(make(3)));
