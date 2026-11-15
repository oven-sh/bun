// Reference: bun build --compile
const { basename } = require("node:path");
const whole = import.meta.glob("./mods/*.cjs", { eager: true });
const byDefault = import.meta.glob("./mods/*.cjs", { eager: true, import: "default" });
for (const key of Object.keys(whole))
  console.log(basename(key), typeof whole[key].default, Object.keys(whole[key]).sort().join(), typeof byDefault[key]);
let text;
try {
  text = import.meta.glob("./mods/*.txt", { eager: true, query: "?raw", import: "default" })["./mods/note.txt"];
} catch (e) { text = e.name; }
console.log(String(text).trim());
module.exports = whole;
