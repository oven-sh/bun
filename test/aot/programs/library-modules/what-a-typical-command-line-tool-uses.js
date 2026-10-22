// A small tool as people write them: parse arguments, walk a folder, read and hash files, compress one, print a table, run a child, and clean up; ten library modules, each by a constant name, some required late inside functions.
const { parseArgs, inspect } = require("node:util");
const path = require("node:path");

function walk(folder) {
  const fs = require("node:fs");
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]));
}
function digest(file) {
  return require("node:crypto").createHash("sha1").update(require("node:fs").readFileSync(file)).digest("hex").slice(0, 8);
}
async function pack(file) {
  const { gzip } = require("node:zlib");
  return (await require("node:util").promisify(gzip)(await require("node:fs/promises").readFile(file))).length;
}

const { values } = parseArgs({ args: ["--depth", "2", "-v"], options: { depth: { type: "string" }, v: { type: "boolean", short: "v" } } });
const root = require("node:fs").mkdtempSync(path.join(require("node:os").tmpdir(), "library-modules-"));
require("node:fs").mkdirSync(path.join(root, "src/lib"), { recursive: true });
for (const [name, text] of [["a.txt", "alpha"], ["src/b.txt", "beta"], ["src/lib/c.txt", "gamma".repeat(100)]]) require("node:fs").writeFileSync(path.join(root, name), text);

const files = walk(root).sort();
console.table(files.map(file => ({ file: path.relative(root, file), sha1: digest(file), bytes: require("node:fs").statSync(file).size })));
console.log(inspect(values), (await pack(files.at(-1))) < 100);
console.log(require("node:child_process").execFileSync("ls", [root]).toString().trim().split("\n").join());
const emitter = new (require("node:events"))();
emitter.once("done", () => require("node:fs").rmSync(root, { recursive: true }));
emitter.emit("done");
console.log(require("node:fs").existsSync(root), new (require("node:url").URL)("file://" + root).protocol);
