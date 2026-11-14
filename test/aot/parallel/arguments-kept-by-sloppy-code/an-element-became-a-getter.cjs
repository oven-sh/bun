// An element was defined anew as a getter: every read calls it.
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
let calls = 0;
Object.defineProperty(kept, 0, { get() { return ++calls; }, configurable: true });
function read(list, turn) { let text = "" + turn; for (let i = 0; i < 5; i++) text += ":" + list[i]; return text; }
globalThis.handed = [read];
for (let turn = 0; turn < 3; turn++) console.log(read(kept, turn));
