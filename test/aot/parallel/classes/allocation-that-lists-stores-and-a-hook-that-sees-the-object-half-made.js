// between two stores of a constructor function stands a call of a function that is found under a hidden name: it sees the keys stored so far, and changes the object that is being made
const hidden = JSON.parse('{"hook":"peek"}');
let log = "";
let how = 0;
globalThis.peek = function (node) { log += " [" + Object.keys(node).join() + "]"; if (how === 1) node.end = "early"; if (how === 2) delete node.pos; if (how === 3) Object.defineProperty(node, "end", { set(value) { log += " own " + value; }, enumerable: true, configurable: true }); if (how === 4) Object.preventExtensions(node); if (how === 5) Object.setPrototypeOf(node, { set end(value) { log += " above " + value; } }); };
function Node(kind, pos, end) { this.pos = pos; this.kind = kind; globalThis[hidden.hook](this); this.end = end; this.id = 0; }
function make(kind) { return new Node(kind, -1, kind + 1); }
function deed(kind) { let text; try { const node = make(kind); text = Object.keys(node).join() + " " + JSON.stringify(node); } catch (error) { text = error.name; } text += log; log = ""; return text; }
console.log(deed(0));
for (let turn = 1; turn < 300; turn++) make(turn);
log = "";
for (how = 0; how < 6; how++) console.log(how, deed(how));
how = 0;
console.log(deed(9));
