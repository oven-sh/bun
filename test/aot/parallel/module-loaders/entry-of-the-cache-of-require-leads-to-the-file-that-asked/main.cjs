const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const kit = require("./kit.cjs");

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "entry-of-the-cache-"));
const settings = path.join(folder, "settings.json");
fs.writeFileSync(settings, JSON.stringify({ port: 8080 }));
console.log(kit.load(settings).port);
fs.rmSync(folder, { recursive: true });

const entry = require.cache[settings];
const asked = entry.parent;
console.log(path.basename(asked.filename), asked.loaded, typeof asked.require);
console.log(Object.keys(asked.exports).join(), asked.exports === kit, asked.exports.sum(2, 3));
console.log(asked.children.map(child => path.basename(child.filename)).join(), asked.children[0] === entry);
console.log(asked.parent === module, path.basename(require.cache[settings].parent.parent.filename));
