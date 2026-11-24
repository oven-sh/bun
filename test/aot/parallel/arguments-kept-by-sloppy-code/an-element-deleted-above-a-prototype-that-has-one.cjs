// An element was deleted, and the prototype exchanged for an object that has a member under its index and under one past the end.
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
delete kept[1];
Object.setPrototypeOf(kept, { 1: "up", 4: "past" });
function read(list, turn) { let text = "" + turn; for (let i = 0; i < 5; i++) text += ":" + list[i]; return text; }
globalThis.handed = [read];
for (let turn = 0; turn < 3; turn++) console.log(read(kept, turn));
