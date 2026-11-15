// Build prints: 0 x warn: TS100098: This reads "words/de.json", but the executable has no file at that path. Embed it with --asset words/de.json
import fs from "node:fs";
import path from "node:path";
import { many } from "./words/many.js";
const stem = process.argv[2] ?? "de";
console.log(many, require("./words/" + stem + ".json").hello);
const at = new URL("./words/de.json", import.meta.url);
console.log(fs.existsSync(at), JSON.parse(fs.readFileSync(at, "utf8")).hello);
