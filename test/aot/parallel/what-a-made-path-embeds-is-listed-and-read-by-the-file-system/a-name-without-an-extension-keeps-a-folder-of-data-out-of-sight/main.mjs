import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "locales");
const ask = (word, work) => {
  try {
    console.log(word, work());
  } catch (error) {
    console.log(word, "threw", error.code ?? error.name);
  }
};
ask("required", () => require(path.join(folder, JSON.parse('"fr.json"'))).hello);
ask("listed", () => fs.readdirSync(folder).sort().join(" "));
process.exit(0);
/* Output:
required bonjour
listed threw ENOENT
*/
