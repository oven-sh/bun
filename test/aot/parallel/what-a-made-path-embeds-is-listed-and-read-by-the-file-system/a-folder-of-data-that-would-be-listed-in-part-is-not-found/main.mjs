import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "pages");
const ask = (word, work) => {
  try {
    console.log(word, work());
  } catch (error) {
    console.log(word, "threw", error.code ?? error.name);
  }
};
const stem = JSON.parse('"a"');
ask("required", () => require(path.join(folder, stem + ".json")).title);
ask("listed", () => fs.readdirSync(folder).sort().join(" "));
ask("exists", () => ["a.json", "b.json", "a.txt"].map(name => fs.existsSync(path.join(folder, name))).join(" "));
ask("read", () => fs.readFileSync(path.join(folder, "a.json"), "utf8").length);
process.exit(0);
/* Output:
required a
listed threw ENOENT
exists false false false
read threw ENOENT
*/
