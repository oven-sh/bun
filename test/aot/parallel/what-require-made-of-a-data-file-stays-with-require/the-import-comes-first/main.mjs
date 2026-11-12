import path from "node:path";
const folder = path.join(import.meta.dir, "data");
const names = (process.env.MADE_UP_NAMES ?? "a.json b.toml c.yaml").split(" ");
for (const name of names) {
  const file = path.join(folder, name);
  const first = (await import(file)).default;
  first.touched = 1;
  const second = require(file);
  console.log(name, first === second, second.touched ?? "none", second.is ?? second.default?.is, (await import(file)).default === first, require(file) === second);
}
