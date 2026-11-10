import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "data");
for (const name of fs.readdirSync(folder).sort()) {
  const file = path.join(folder, name);
  const first = require(file);
  const text = fs.readFileSync(file, "utf8");
  console.log(name, first === require(file), first.is, text.length);
  first.touched = 1;
  const imported = (await import(file)).default;
  console.log(name, fs.readFileSync(file, "utf8") === text, imported.is, imported.touched ?? "none", imported === first);
}
process.exit(0);
