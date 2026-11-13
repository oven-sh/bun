"use strict";
// The test of a loop stores a field of an unknown object into a variable and calls a method of it, as compilers write optional chains.
const lines = [];
function freeName(context, raw) {
  let i = 0;
  let text = raw;
  var names;
  while (((names = context.names) == null ? void 0 : names.has(text)) || text === context.taken) {
    i++;
    text = `${raw}_${i}`;
  }
  return text;
}
function firstFree(context, raw) {
  let text = raw;
  let names;
  while ((names = context.names).has(text)) text += "_";
  return text + names.size;
}
function rowsOf(table, limit) {
  let text = "";
  let rows;
  for (let i = 0; ((rows = table.rows) == null ? void 0 : rows[i]) !== undefined && i < limit; i++) text += rows[i] + ";";
  return text;
}
const unknown = JSON.parse('[{"taken":"b"},{"taken":"a"},{"taken":1}]');
unknown.push({ names: new Set(["a", "a_1", "b"]), taken: "c" }, { names: new Map([["c", 1]]), taken: "c_1" }, { names: null, taken: "c" });
for (const context of unknown) lines.push(["a", "b", "c", "d"].map(raw => freeName(context, raw)).join());
lines.push(firstFree({ names: new Set(["x", "x_"]) }, "x"), firstFree({ names: new Map() }, "x"));
for (const table of [{ rows: ["p", "q"] }, {}, { rows: JSON.parse("[1,2,3]") }, { rows: "text" }, { rows: null }]) lines.push(rowsOf(table, 4));
try {
  firstFree({}, "x");
} catch (error) {
  lines.push(error.name);
}
console.log(lines.join("\n"));
