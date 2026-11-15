import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "locales");
const names = fs.readdirSync(folder, { recursive: true }).sort();
const numbers = new Set();
for (const name of names) {
  const found = fs.statSync(path.join(folder, name));
  numbers.add(found.ino);
  const times = [found.atimeMs, found.mtimeMs, found.ctimeMs].map(time => time > 0 && time <= Date.now());
  console.log(name.split(path.sep).join("/"), found.isFile(), found.isDirectory(), found.isFile() ? found.size > 0 : "-", found.ino > 0, found.isFile() ? found.nlink : "-", times.join(" "), found.mtime instanceof Date);
  if (found.isFile()) console.log("  ", require(path.join(folder, name)).hello);
}
console.log("numbers of their own:", numbers.size === names.length);
const whole = fs.statSync(folder);
console.log("the folder:", whole.isDirectory(), whole.mtimeMs > 0, whole.ino > 0);
console.log("the owner:", fs.statSync(path.join(folder, "en.json")).uid === process.getuid?.());
process.exit(0);
