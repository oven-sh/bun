import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "locales");
const ask = (word, work) => {
  try {
    console.log(word, work());
  } catch (error) {
    console.log(word, error.code ?? error.name);
  }
};
for (const file of fs.readdirSync(folder).sort()) {
  ask("require " + file, () => require(path.join(folder, file)).hello);
  ask("exists " + file, () => fs.existsSync(path.join(folder, file)));
  ask("read " + file, () => fs.readFileSync(path.join(folder, file), "utf8").trim());
}
process.exit(0);
/* Output:
require en.json hello
exists en.json true
read en.json ENOENT
require fr.json bonjour
exists fr.json true
read fr.json ENOENT
*/
