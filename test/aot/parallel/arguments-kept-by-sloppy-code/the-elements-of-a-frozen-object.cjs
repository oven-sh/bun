// The object was frozen, which parts its elements from the parameters.
let store;
function keep(first, second) { store = value => { first = value; }; return arguments; }
const kept = Object.freeze(keep(1, "two", null));
function read(list, turn) { let text = "" + turn; for (let i = 0; i < 5; i++) text += ":" + list[i]; return text; }
globalThis.handed = [read];
for (let turn = 0; turn < 3; turn++) { store(turn * 10); console.log(read(kept, turn)); }
