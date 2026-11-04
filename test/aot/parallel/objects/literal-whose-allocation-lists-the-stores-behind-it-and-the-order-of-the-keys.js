// stores stand right behind a literal, in the order of the names, in another order, over a name that the literal has, and behind a call under a hidden name that sees the object in between
const hidden = JSON.parse('{"hook":"peek"}');
let log = "";
globalThis.peek = function (entry) { log += " [" + Object.keys(entry).join() + "]"; };
function inOrder(name) { const entry = { name }; entry.count = 0; entry.next = null; return entry; }
function otherOrder(name) { const entry = { name }; entry.next = null; entry.count = 0; return entry; }
function overName(name) { const entry = { name, count: 1 }; entry.next = null; entry.name = "over"; entry.count = 2; return entry; }
function seenBetween(name) { const entry = { name }; entry.count = 0; globalThis[hidden.hook](entry); entry.next = null; return entry; }
function fromNothing(name) { const entry = {}; entry.name = name; entry.count = 0; entry.next = undefined; return entry; }
function deed(entry) { let names = ""; for (const name in entry) names += name + ","; const text = names + " " + Object.keys(entry).join() + " " + JSON.stringify(entry) + " " + Object.keys({ ...entry }).join() + log; log = ""; return text; }
console.log(deed(inOrder(1)), deed(otherOrder(1)), deed(overName(1)), deed(seenBetween(1)), deed(fromNothing(1)));
for (let turn = 0; turn < 300; turn++) { inOrder(turn); otherOrder(turn); overName(turn); seenBetween(turn); fromNothing(turn); }
log = "";
console.log(deed(inOrder("a")), deed(otherOrder("a")), deed(overName("a")), deed(seenBetween("a")), deed(fromNothing("a")));
const first = inOrder("x");
const second = inOrder("x");
first.count = 7;
console.log(first !== second, deed(first), deed(second));
