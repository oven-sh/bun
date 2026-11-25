const pattern = /a/g;
pattern[0] = "x";
pattern[1] = { v: 5 };
const table = new Map([pattern]);
let kinds = "";
for (const value of table.values()) kinds += typeof value;
for (const key of table.keys()) kinds += typeof key;
const found = table.get("x");
console.log(kinds + typeof found + (found === undefined ? "nothing" : found.v + 1));
