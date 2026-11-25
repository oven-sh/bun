import fs from "node:fs";
import path from "node:path";
import { many } from "./words/lib/many.js";
const folder = path.join(import.meta.dir, "words");
const listed = fs.readdirSync(folder).sort();
console.log(listed.join(" "));
for (const name of listed) {
  if (!name.endsWith(".json")) continue;
  console.log(name, require("./words/" + name.slice(0, -5) + ".json").hello, fs.readFileSync(path.join(folder, name), "utf8").length);
}
console.log(many);
