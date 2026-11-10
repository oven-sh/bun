import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "locales");
try {
  const found = {};
  for (const file of fs.readdirSync(folder).sort()) found[path.parse(file).name] = require(path.join(folder, file)).hello;
  console.log(Object.keys(found).length, JSON.stringify(found));
} catch (error) {
  console.log(error.code ?? error.name);
}
process.exit(0);
