// The keys come out of data: negative, a fraction, texts of digits, and numbers past 32 bits.
// COUNT: operation:operationAOTGetByVal <= 16
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
const keys = JSON.parse('[0,-1,1.5,"1","01",2,4294967295,4294967296,4294967297,-0,"length"]');
function read(list, turn) { let text = "" + turn; for (let i = 0; i < keys.length; i++) text += ":" + list[keys[i]]; return text; }
globalThis.handed = [read];
for (let turn = 0; turn < 3; turn++) console.log(read(kept, turn));
