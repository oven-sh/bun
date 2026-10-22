// Untyped programs: a read file. It prints what plain Bun prints.
import fs from "node:fs";
console.log(fs.readFileSync("/etc/hostname", "utf8").length);
