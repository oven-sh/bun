// a part of the growth is a symbol in one turn: the join throws a TypeError there, and the text is what it was in front of that growth
let last = "";
function grow(parts: unknown[]) { let s = ""; for (let i = 0; i < parts.length; i++) { last = "turn " + i; s += parts[i] as string; } return s; }
function growByTwo(parts: unknown[]) { let s = ""; for (let i = 0; i < parts.length; i++) { last = "turn " + i; s += "p" + i + (parts[i] as string); } return s; }
function tell(f: () => unknown) { last = "none"; try { return "gave " + f(); } catch (e) { return (e as Error).name + " in " + last; } }
console.log(tell(() => grow([])), tell(() => grow(["a", 1, null])), tell(() => grow(["a", Symbol("b"), "c"])), tell(() => grow([Symbol.iterator])));
console.log(tell(() => growByTwo(["a", 1, null])), tell(() => growByTwo(["a", Symbol("b"), "c"])), tell(() => growByTwo([Symbol.iterator])));
for (let turn = 0; turn < 40; turn++) tell(() => grow(["a", turn, turn % 3 ? Symbol("s") : "t"]));
console.log(tell(() => grow(["again", 1n, true, undefined, -0])));
