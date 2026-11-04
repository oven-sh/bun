// a getter is laid over the tested field by code that nobody sees: each alternative of the row reads it anew
type Item = { kind: number; text: string };
function pick(item: Item) { if (item.kind === 1 || item.kind === 4 || item.kind === 9) return item.text; return "none"; }
const hidden = JSON.parse('{"define":"defineProperty"}');
let reads = 0;
function deed(item: Item) {
  (Reflect as any)[hidden.define](item, "kind", { get() { reads++; return reads % 3 === 0 ? 9 : 0; }, configurable: true });
}
const item: Item = { kind: 4, text: "item" };
console.log(pick(item), pick({ kind: 5, text: "other" }));
let told = "";
for (let i = 0; i < 300; i++) told += pick({ kind: i % 10, text: String(i % 10) })[0];
console.log(told.slice(0, 20));
deed(item);
console.log(pick(item), String(reads));
for (let i = 0; i < 4; i++) console.log(pick(item), String(reads));
