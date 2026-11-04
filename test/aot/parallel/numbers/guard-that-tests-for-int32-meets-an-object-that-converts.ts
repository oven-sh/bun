// a parameter written `number` that every call in sight fills with an int32 is handed an object whose valueOf counts its calls
function between(ch: number) { return ch >= 65 && ch <= 90; }
let conversions = 0;
const outside: any = Object.assign(JSON.parse("{}"), { valueOf() { conversions++; return 70 + conversions; } });
function deed(value: number) { return String(between(value)); }
console.log(deed(70), deed(91));
for (let turn = 0; turn < 300; turn++) deed(turn & 127);
console.log(deed(outside), conversions);
console.log(deed(outside), conversions);
for (let turn = 0; turn < 12; turn++) deed(outside);
console.log(deed(outside), conversions);
console.log(deed(70), conversions);
