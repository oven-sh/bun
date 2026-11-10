// A file that the executable loads from disk asks module.parent: as outside-package-finds-above-itself-what-it-finds-without-aot, for --aot-allow-code-from-disk.
// Flags: --aot-allow-code-from-disk
// Reference: bun build --compile
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const kit = require("./kit.cjs");

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "file-from-disk-"));
const stranger = path.join(folder, "stranger.cjs");
fs.writeFileSync(
  stranger,
  `const attempt = read => { try { return String(read()); } catch (error) { return "throws " + error.name; } };
const above = module.parent;
module.exports = [
  "is there: " + attempt(() => Boolean(above)),
  "loaded: " + attempt(() => above.loaded),
  "typeof exports: " + attempt(() => typeof above.exports),
  "own keys: " + attempt(() => Reflect.ownKeys(above).join()),
  "keys of exports: " + attempt(() => Object.keys(above.exports).join()),
  "a member is called: " + attempt(() => above.exports.sum("a", "b")),
  "require, parent: " + attempt(() => typeof above.require + " " + typeof above.parent),
];
`,
);
for (const line of kit.load(stranger)) console.log(line);
fs.rmSync(folder, { recursive: true });
console.log(kit.sum(1, 2), Object.keys(kit).join());
