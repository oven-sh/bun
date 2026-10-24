// Untyped programs: a read file. It prints what plain Bun prints.
import fs from "node:fs";
// A small file that every machine of the kind has.
const file = { linux: "/etc/hostname", win32: "C:\\Windows\\System32\\drivers\\etc\\hosts" }[process.platform as string] ?? "/etc/hosts";
console.log(fs.readFileSync(file, "utf8").length);
