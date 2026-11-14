import fs, { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const text = fs.readFileSync(new URL("./add.txt", import.meta.url), "utf8");
export const add = new Function("a", "b", text);
export const twice = new Function("a", readFileSync(path.join(import.meta.dirname, "twice.txt"), "utf8"));
export const named = new Function("a", readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "./twice.txt"), "utf8") + "//# sourceURL=twice.js");
