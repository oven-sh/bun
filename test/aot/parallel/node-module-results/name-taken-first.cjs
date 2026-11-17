const { join } = require("path");
function total(count) {
  let length = 0, text = "", other = 0;
  for (let i = 0; i < count; i++) {
    const joined = join("a", "b" + i);
    if (typeof joined === "string") {
      length += joined.length;
      text += joined.charCodeAt(0);
    } else other++;
  }
  return [length, text, other].join();
}
console.log(total(9));
require("path").join = () => 41;
console.log(total(9), join("c", "d"));
