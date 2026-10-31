// A table of many names has one key that spells an index. Each name is looked for once, and none of the looks leaves compiled code: what is counted makes the names and stores under them.
// COUNT: operations <= 1250
const names = [];
for (let i = 0; i < 600; i++) names.push("n" + i.toString(36));
const table = Object.create(null);
table["123"] = 3;
for (const name of names) table[name] = name.length;
let sum = 0;
for (let i = 0; i < names.length; i++) sum += table[names[i]];
let present = 0;
for (let i = 0; i < names.length; i++) if (names[i] in table) present++;
console.log(sum, present, table["123"], table[123]);
