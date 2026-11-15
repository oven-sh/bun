// The prototype was exchanged for an object that has a member under an index past the end; nothing else was done to the object.
// COUNT: operation:operationAOTGetByVal <= 6
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
Object.setPrototypeOf(kept, { 3: "past" });
function read(list, turn) { let text = "" + turn; for (let i = 0; i < 5; i++) text += ":" + list[i]; return text; }
globalThis.handed = [read];
for (let turn = 0; turn < 3; turn++) console.log(read(kept, turn));
