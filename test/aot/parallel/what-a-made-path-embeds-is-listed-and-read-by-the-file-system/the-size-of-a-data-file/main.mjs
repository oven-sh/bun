import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "parts");
const data = fs
  .readdirSync(folder, { recursive: true })
  .sort()
  .filter(name => /\.(json|toml|txt)$/.test(name));
for (const name of data) console.log(name.split(path.sep).join("/"), fs.statSync(path.join(folder, name)).size);
console.log(
  "not empty:",
  data.filter(name => fs.statSync(path.join(folder, name)).size > 0).length,
  "of",
  data.length,
);
console.log("lstat", fs.lstatSync(path.join(folder, "b.json")).size);
console.log("promises", (await fs.promises.stat(path.join(folder, "d.txt"))).size);
console.log("bigint", fs.statSync(path.join(folder, "c.toml"), { bigint: true }).size);
for (const name of data) {
  const loaded = require(path.join(folder, name));
  console.log(name.split(path.sep).join("/"), JSON.stringify(loaded.is ?? loaded.default ?? loaded));
}
process.exit(0);
