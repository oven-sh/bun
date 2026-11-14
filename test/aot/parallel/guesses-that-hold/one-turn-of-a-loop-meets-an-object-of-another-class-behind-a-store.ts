// each turn stores into an object, calls, and reads off it on either side of a branch; in one turn the object is a literal with a setter and a getter: each runs once a turn
class Item { seen: boolean; v: number; constructor(v: number) { this.seen = false; this.v = v; } }
let calls = 0;
let log = "";
function count() { calls++; }
function total(items: Item[]) { let odd = 0; let even = 0; for (let i = 0; i < items.length; i++) { const n = items[i]; n.seen = true; count(); if (n.v & 1) odd += n.v; else even += n.v; } return odd + ":" + even; }
const items: Item[] = [];
for (let i = 0; i < 64; i++) items.push(new Item(i));
console.log(total(items), calls);
const other: any = JSON.parse("{}");
Object.defineProperty(other, "seen", { set(value) { log += "s"; } });
Object.defineProperty(other, "v", { get() { log += "g"; return 1000; } });
items[40] = other;
console.log(total(items), calls, log);
console.log(total(items), calls, log);
