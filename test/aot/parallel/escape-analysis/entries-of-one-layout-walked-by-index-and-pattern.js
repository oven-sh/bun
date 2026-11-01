// The pairs of Object.entries over an object of one known layout are never made where a loop counts up to the length of the list and takes each pair apart:
// the number of pairs is known, so no loop is left either.
// IR= 0 byPattern NewArray|URShift|LoopHint|Switch
// IR= 0 byPatternOfThree NewArray|URShift|LoopHint|Switch
// IR= 0 countOfPairs URShift|CallBuiltin
let guard = 0;

function byPattern(o) { if (guard) byPattern(o); const entries = Object.entries(o); let total = 0; for (let i = 0; i < entries.length; i++) { const [k, v] = entries[i]; total += k.length + v; } return total; }
function byPatternOfThree(o) { if (guard) byPatternOfThree(o); const entries = Object.entries(o); let out = ""; for (let i = 0; i < entries.length; i++) { const [k, v] = entries[i]; out += k + "=" + v + ";"; } return out; }
function countOfPairs(o) { if (guard) countOfPairs(o); return Object.entries(o).length; }
function backwards(o) { if (guard) backwards(o); const entries = Object.entries(o); let out = ""; for (let i = entries.length - 1; i >= 0; i--) { const [k, v] = entries[i]; out += k + v; } return out; }
function pastTheEnd(o) { if (guard) pastTheEnd(o); const entries = Object.entries(o); let out = ""; for (let i = 0; i <= entries.length; i++) { const [k, v] = entries[i] ?? ["none", i]; out += k + v + ";"; } return out; }

const point = { x: 1, y: 2.5 };
const named = { first: 1, second: "two", third: null };
const held = { left: 4, right: 5.5 };
let total = 0;
for (let n = 0; n < 20; n++) { point.x = n & 7; total += byPattern(point) + countOfPairs(held); }
console.log(total, byPattern(point), byPatternOfThree(named), countOfPairs(held));
console.log(backwards(held), backwards(named), pastTheEnd(held), pastTheEnd({}));
guard += total > 1e12 ? 1 : 0;
