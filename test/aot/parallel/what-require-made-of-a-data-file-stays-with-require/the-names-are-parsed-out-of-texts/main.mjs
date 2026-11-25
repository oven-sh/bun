import path from "node:path";
const folder = path.join(import.meta.dir, "data");
for (const name of [JSON.parse('"a.json"'), JSON.parse('"b.toml"')]) {
  const file = path.join(folder, name);
  const first = require(file);
  first.touched = 1;
  const second = (await import(file)).default;
  console.log(name, first === second, second.touched ?? "none", second.is, require(file) === first);
}
