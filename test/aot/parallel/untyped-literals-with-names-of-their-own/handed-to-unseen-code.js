const change = (0, eval)("(row) => { row.added = 1; delete row.shared; return row; }");
const rows = [{ one: 1, shared: "s" }, { two: 2, shared: "t" }, { three: 3, shared: "u" }];
let text = "";
for (const row of rows) text += String(row.shared) + String(change(row).shared) + String(row.added) + Object.keys(row).join("") + ";";
console.log(text);
