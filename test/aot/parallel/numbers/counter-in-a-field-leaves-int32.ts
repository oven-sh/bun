// a counter in a field, of which int32 is expected, is stepped past 2 ** 31 - 1 and then by a fraction, which a call that nobody follows hands over
class Tally { count = 0; step(by: number) { this.count += by; return this.count; } }
const tally = new Tally();
(globalThis as any).kept = tally;
function deed(by: number) { return String(tally.step(by)); }
const unseen = JSON.parse("{}");
unseen.deed = deed;
console.log(deed(1), deed(2));
for (let turn = 0; turn < 300; turn++) deed(1);
console.log(deed(2147483000));
for (let turn = 0; turn < 400; turn++) deed(1);
console.log(deed(1), deed(-1));
console.log(String(unseen.deed(0.5)), deed(1), String(unseen.deed(-0.5)));
console.log(String(unseen.deed(9007199254740000)), deed(1000), deed(1));
