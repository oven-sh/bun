// a collection runs in each turn of a loop that alone has the generator, whose body holds objects that nothing else names
function* pairs(limit: number, label: { text: string }) { for (let i = 0; i < limit; i++) { const pair = { left: label.text + i, right: [i, i + 1] }; yield pair; pair.right.push(i + 2); yield pair; } }
function deed(limit: number) { let text = ""; for (const pair of pairs(limit, { text: "p" })) { Bun.gc(true); text += pair.left + pair.right.join() + ";"; } return text; }
console.log(deed(2));
for (let i = 0; i < 3; i++) console.log(deed(i));
