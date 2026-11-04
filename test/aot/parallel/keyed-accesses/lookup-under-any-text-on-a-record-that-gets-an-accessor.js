// a table of plain values is read under a text that arrives, between a store into a variable and the read of it; then a getter that stores into the variable is laid on the table
let last = "start";
const table = { a: 1, b: 2 };
function pick(name) {
  last = "before";
  const found = table[name];
  return found + ":" + last;
}
function asks(name) {
  last = "before";
  const found = name in table;
  return found + ":" + last;
}
const names = JSON.parse('["a", "b", "c", "toString", "__proto__", "constructor", "1", ""]');
function deed() {
  let line = "";
  for (let i = 0; i < names.length; i++)
    line += (typeof pick(names[i]) === "string" ? pick(names[i]).replace(/function[^]*\}/, "function") : "?") + " " + asks(names[i]) + " ";
  return line;
}
console.log(deed());
for (let turn = 0; turn < 3; turn++)
  console.log(deed());
Object.defineProperty(table, "c", { get() { last = "getter ran"; return 3; }, configurable: true, enumerable: true });
console.log(deed());
Object.setPrototypeOf(table, { get d() { last = "getter above ran"; return 4; } });
names.push("d");
console.log(deed());
