// a parameter written `number` that every call in sight fills with an int32 is handed a fraction that comes from outside, by a call that nobody follows
function isBig(ch: number) { return ch >= 65; }
const outside: any[] = JSON.parse("[64.5, 65.5, -0, 2147483648, 1e300]");
function deed(value: number) { return String(isBig(value)); }
const unseen = JSON.parse("{}");
unseen.deed = deed;
unseen.isBig = isBig;
console.log(deed(70), deed(3));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(65 + (turn & 1));
console.log(log);
for (let i = 0; i < outside.length; i++) console.log(String(unseen.deed(outside[i])), String(unseen.isBig(outside[i])));
console.log(deed(70), deed(64));
