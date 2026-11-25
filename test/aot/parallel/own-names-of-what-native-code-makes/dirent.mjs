import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "own-names-")); fs.writeFileSync(path.join(folder, "a.txt"), "a"); fs.mkdirSync(path.join(folder, "b"));
const said = [];
function tell(label, d) { said.push(label + " own: " + Object.getOwnPropertyNames(d).sort().join(), [d.name, typeof d.parentPath, typeof d.path, d.parentPath === folder, typeof d.isFile, d.isFile(), d.isDirectory(), d.isSymbolicLink()].join()); }
for (const d of fs.readdirSync(folder, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) tell("readdirSync", d);
for (const d of (await fs.promises.readdir(folder, { withFileTypes: true })).sort((x, y) => (x.name < y.name ? -1 : 1))) tell("promises.readdir", d);
const dir = fs.opendirSync(folder); const first = dir.readSync(); said.push("opendir own: " + Object.getOwnPropertyNames(first).sort().join(), typeof first.name, typeof first.parentPath); dir.closeSync();
fs.rmSync(folder, { recursive: true });
console.log(said.join("\n"));
