// what a test compares the field with calls code that stores into the field: the next alternative reads what was stored
type Item = { kind: number; text: string };
const hidden = JSON.parse('{"set":"set"}');
function deed(item: Item, kind: number) { (Reflect as any)[hidden.set](item, "kind", kind); }
function inFront(item: Item) { if (item.kind === (deed(item, 4), 1) || item.kind === 4) return "listed " + item.kind; return "none " + item.kind; }
function between(item: Item) { if (item.kind === 1 || item.kind === (deed(item, 9), 4) || item.kind === 9) return "listed " + item.kind; return "none " + item.kind; }
console.log(inFront({ kind: 5, text: "a" }), inFront({ kind: 1, text: "b" }), inFront({ kind: 4, text: "c" }));
console.log(between({ kind: 5, text: "a" }), between({ kind: 1, text: "b" }), between({ kind: 4, text: "c" }));
let told = "";
for (let i = 0; i < 300; i++) told = inFront({ kind: i % 7, text: "t" }) + " " + between({ kind: i % 7, text: "t" });
console.log(told);
