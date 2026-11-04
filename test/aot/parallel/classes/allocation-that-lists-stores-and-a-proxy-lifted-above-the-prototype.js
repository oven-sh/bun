// a Proxy is lifted above the prototype object of a constructor function by a hidden name: its trap sees every store that creates a property, in the order of the stores
const hidden = JSON.parse('{"lift":"setPrototypeOf"}');
let log = "";
function Node(kind, pos, end) { this.pos = pos; this.end = end; this.kind = kind; this.id = 0; }
function make(kind) { return new Node(kind, -1, kind + 1); }
function show(node) { const text = Object.keys(node).join() + " " + JSON.stringify(node) + log; log = ""; return text; }
const trap = { set(target, key, value, receiver) { log += " " + String(key) + "=" + value; return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true }); } };
function deed(above) { Reflect[hidden.lift](Node.prototype, above); }
console.log(show(make(0)));
for (let turn = 1; turn < 300; turn++) make(turn);
deed(new Proxy({}, trap));
console.log(show(make(1)));
for (let turn = 0; turn < 3; turn++) console.log(show(make(turn)));
deed(Object.prototype);
console.log(show(make(2)));
