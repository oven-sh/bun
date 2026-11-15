import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dirname, "data");
try {
  const found = {};
  for (const file of fs.readdirSync(folder).sort()) {
    const whole = await import(path.join(folder, file));
    found[file] = (whole.default ?? whole).hello;
  }
  console.log(Object.keys(found).length, JSON.stringify(found));
} catch (error) {
  console.log(error.code ?? error.name);
}
process.exit(0);
