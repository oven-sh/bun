const path = require("path");
const { createRequire } = require("module");
function total(count) {
  let length = 0, text = "", other = 0;
  for (let i = 0; i < count; i++) {
    const joined = path.join("a", "b" + i);
    if (typeof joined === "string") {
      length += joined.length;
      text += joined.charCodeAt(0);
    } else other++;
  }
  return [length, text, other].join();
}
console.log(total(9));
const other = createRequire(__filename);
Object.assign(other("path"), { join: () => undefined });
console.log(total(9), path.join("c", "d"));
