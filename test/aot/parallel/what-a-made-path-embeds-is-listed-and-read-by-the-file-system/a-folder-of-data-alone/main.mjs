import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dirname, "locales");
try {
  const found = {};
  for (const file of fs.readdirSync(folder).sort()) found[file] = (await import(path.join(folder, file), { with: { type: "json" } })).default.hello;
  console.log(Object.keys(found).length, JSON.stringify(found));
} catch (error) {
  console.log(error.code ?? error.name);
}
process.exit(0);
