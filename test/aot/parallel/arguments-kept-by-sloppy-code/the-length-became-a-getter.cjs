// The length was defined anew as a getter: every read calls it.
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
let calls = 0;
Object.defineProperty(kept, "length", { get() { return ++calls; }, configurable: true });
function count(list, turn) { let sum = turn; for (let i = 0; i < 4; i++) sum += list.length; return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) console.log(count(kept, turn));
