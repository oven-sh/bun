import path from "node:path";
const folder = path.join(import.meta.dir, "data");
const names = (process.env.MADE_UP_NAMES ?? "a.json b.toml").split(" ");
for (const name of names) {
  const file = path.join(folder, name);
  const first = require(file);
  first.touched = 1;
  const second = (await import(file)).default;
  console.log(name, first === second, second.touched ?? "none", second.is, require(file) === first);
}
