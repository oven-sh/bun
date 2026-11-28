// What is truthy counts, even if its text is empty.
const { win32 } = require("node:path");
process.cwd = () => (console.log("cwd"), "/c");
for (const held of [[], "", 0, null, "C:\\held"]) {
  process.env = { "=C:": held };
  console.log(win32.resolve("C:a"));
}
