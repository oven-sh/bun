import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "migrations");
try {
  const names = fs.readdirSync(folder, { withFileTypes: true }).map(entry => entry.name + (entry.isDirectory() ? "/" : "")).sort();
  console.log(names.length, names.join(" "));
  for (const name of names) {
    const file = path.join(folder, name);
    try {
      if (name.endsWith(".cjs")) console.log(name, require(file).up());
      else if (name.endsWith(".json")) console.log(name, require(file).up);
      else console.log(name, "passed over");
    } catch (error) {
      console.log(name, error.code ?? error.name);
    }
  }
  console.log(fs.existsSync(path.join(folder, "003-c.json")), fs.existsSync(path.join(folder, "001-a.cjs")), fs.statSync(path.join(folder, "001-a.cjs")).isFile());
} catch (error) {
  console.log(error.code ?? error.name);
}
process.exit(0);
