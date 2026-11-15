import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "parts");
const ask = async (word, work) => {
  try {
    console.log(word, await work());
  } catch (error) {
    console.log(word, error.code ?? error.name);
  }
};
(async () => {
  await ask("listed", () => fs.readdirSync(folder).sort().join(" "));
  await ask("exists", () => ["fine.json", "odd.json", "odd.toml"].map(name => fs.existsSync(path.join(folder, name))).join(" "));
  for (const name of fs.readdirSync(folder).sort()) await ask("require " + name, () => require(path.join(folder, name)).is);
  process.exit(0);
})();
