// The call had fewer operands than the function has parameters, and the prototype was exchanged for an object that has a member under the index of a parameter that no operand came for.
// COUNT: operation:operationAOTGetByVal <= 12
function keep(first, second, third) { second = 5; third = 6; return arguments; }
const kept = keep(1);
Object.setPrototypeOf(kept, { 2: "up" });
function read(list, turn) { let text = "" + turn; for (let i = 0; i < 5; i++) text += ":" + list[i]; return text; }
globalThis.handed = [read];
for (let turn = 0; turn < 3; turn++) console.log(read(kept, turn));
