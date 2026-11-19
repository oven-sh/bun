// The third operand is undefined, null, a number, a text: the error is the one of plain Bun; and the target is not called.
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
let called = 0;
function target() { called++; return "called"; }
const lists = [undefined, null, 5, "text"];
const table = { target };
const name = JSON.parse('"target"');
function run(turn) { let text = ""; for (let i = 0; i < upTo[4]; i++) { try { text += ":" + Reflect.apply(table[name], turn, lists[i]); } catch (error) { text += ":" + error.name + " " + error.message; } } return text + called; }
globalThis.handed = [run];
for (let turn = 0; turn < 2; turn++) console.log(run(turn));
