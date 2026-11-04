// a product, a comparison and the length of a list are written on both sides of an await, and whoever runs meanwhile lengthens the list
const list = [1, 2, 3];
async function subject(a, b, xs, p) { if (typeof a !== "number" || typeof b !== "number") return "no numbers"; const first = a * b; const less = a < b; const before = xs.length; await p; return String(first + a * b) + "," + String(less === a < b) + "," + String(before) + "," + String(xs.length); }
async function deed() { const answer = subject(2.5, 4, list, null); list.push(0); return await answer; }
console.log(await subject(2.5, 4, [1], null));
console.log(await deed());
let text = "";
for (let i = 0; i < 300; i++) text = await deed();
console.log(text);
console.log(await subject(2.5, 4, [1], null));
