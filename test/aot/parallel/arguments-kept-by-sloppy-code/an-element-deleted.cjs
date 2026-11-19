// An element was deleted: the read finds nothing, and the parameter goes its own way.
let store;
function keep(first, second) { store = value => { second = value; }; return arguments; }
const kept = keep(1, "two", null);
delete kept[1];
function read(list, turn) { let text = "" + turn; for (let i = 0; i < 5; i++) text += ":" + list[i]; return text; }
globalThis.handed = [read];
for (let turn = 0; turn < 3; turn++) { store(turn); console.log(read(kept, turn)); }
