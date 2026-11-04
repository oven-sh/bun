// a text is joined of a written text and an integer on each of two sides, joined with more behind both sides, and then used as a key of an object and of a map
const table: Record<string, string> = { a1z: "first", b2z: "second", "a-1z": "minus", a0z: "zero" };
const map = new Map<string, number>([["a1z", 1], ["b2z", 2], ["a0z", 0]]);
function subject(c: unknown, x: number) { const s = c ? "a" + (x | 0) : "b" + (x | 0); return s + "z"; }
function deed(c: unknown, x: number) { const key = subject(c, x); return String(table[key]) + String(map.get(key)) + String(key === "a1z") + String(key.length); }
console.log(deed(true, 1), deed(false, 2), deed(1, -1), deed(1, -0), deed(0, 1), deed(1, 1.9), deed(1, 2 ** 32 + 1));
let found = 0;
for (let i = 0; i < 300; i++) found += map.has(subject(i % 2, i % 4)) ? 1 : 0;
console.log(String(found));
table[subject(JSON.parse("0"), 7)] = "late";
console.log(deed(JSON.parse("0"), JSON.parse("7")), Object.keys(table).join());
