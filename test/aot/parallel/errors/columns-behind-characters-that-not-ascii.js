// The column of a frame counts UTF-16 units from the start of its line, whatever characters are in front of it.
function place(error) {
  return /(\d+:\d+)\)?$/.exec(error.stack.split("\n")[1])[1];
}
const rows = [];
rows.push(["nothing in front", place(new Error())]);
/* é */ rows.push(["two bytes", place(new Error())]);
/* 字 */ rows.push(["three bytes", place(new Error())]);
/* 😀 */ rows.push(["four bytes", place(new Error())]);
/* aé字😀éb */ rows.push(["one of each", place(new Error())]);
rows.push(["behind a string", "字字字".length, place(new Error("字"))]); rows.push(["the second on its line", place(new Error())]);
/* 字 */ function thrower() { /* 字 */ throw new RangeError("字"); }
try { /* éé */ thrower(); } catch (error) { rows.push(["two frames", error.stack.split("\n").slice(1, 3).map(line => /(\d+:\d+)\)?$/.exec(line)[1]).join(" ")]); }
/* a line separator   */ rows.push(["behind a line separator", place(new Error())]);
/* 字 and a paragraph separator   字 */ rows.push(["behind a paragraph separator", place(new Error())]);
rows.push(["the line behind them", place(new Error())]);
const text = `字
字${place(new Error())}`;
rows.push(["in a template over two lines", text.split("\n")[1].slice(1)]);
for (const row of rows) console.log(row.join(" | "));
