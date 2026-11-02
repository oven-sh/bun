// The less common parts of node:fs: cp of a tree, glob, vectors of buffers, an async directory handle, hard links, sync to disk, times through a descriptor, exists and access with callbacks, statfs, a Blob of a file, big integers in stat, and append through a descriptor.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "library-modules-"));
const at = name => path.join(folder, name);
fs.mkdirSync(at("tree/inner"), { recursive: true });
fs.writeFileSync(at("tree/a.js"), "a");
fs.writeFileSync(at("tree/inner/b.js"), "bb");
fs.writeFileSync(at("tree/inner/c.txt"), "ccc");

fs.cpSync(at("tree"), at("copy"), { recursive: true });
await fsp.cp(at("tree"), at("filtered"), { recursive: true, filter: source => !source.endsWith(".txt") });
console.log(fs.readdirSync(at("copy"), { recursive: true }).sort().join(), fs.readdirSync(at("filtered"), { recursive: true }).sort().join());
console.log(fs.globSync("**/*.js", { cwd: at("tree") }).sort().join(), (await Array.fromAsync(fsp.glob("*/*.txt", { cwd: at("tree") }))).join());

const descriptor = fs.openSync(at("vector.txt"), "w+");
console.log(fs.writevSync(descriptor, [Buffer.from("one "), Buffer.from("two")]));
const first = Buffer.alloc(4), second = Buffer.alloc(3);
console.log(fs.readvSync(descriptor, [first, second], 0), first.toString() + second.toString());
fs.appendFileSync(descriptor, " three");
fs.fsyncSync(descriptor);
fs.fdatasyncSync(descriptor);
fs.ftruncateSync(descriptor, 7);
fs.futimesSync(descriptor, 10, 20);
console.log(fs.fstatSync(descriptor).size, fs.fstatSync(descriptor).mtimeMs, typeof fs.fstatSync(descriptor, { bigint: true }).size);
fs.closeSync(descriptor);

const names = [];
for await (const entry of await fsp.opendir(at("tree"))) names.push(entry.name + (entry.isDirectory() ? "/" : ""));
console.log(names.sort().join());
fs.linkSync(at("tree/a.js"), at("hard"));
console.log(fs.statSync(at("hard")).nlink, fs.statSync(at("hard")).ino === fs.statSync(at("tree/a.js")).ino);
console.log(await new Promise(resolve => fs.exists(at("hard"), resolve)), await new Promise(resolve => fs.access(at("hard"), fs.constants.R_OK, resolve)), await new Promise(resolve => fs.access(at("none"), error => resolve(error.code))));
try {
  fs.accessSync(at("none"));
} catch (error) {
  console.log(error.code, path.basename(error.path));
}
console.log(Object.keys(fs.statfsSync(folder)).sort().join(), await (await fs.openAsBlob(at("tree/inner/c.txt"))).text());
console.log(await new Promise(resolve => fs.mkdir(at("tree"), error => resolve(error.code))), await fsp.rmdir(at("tree")).catch(error => error.code), await fsp.unlink(at("tree")).catch(error => ["EPERM", "EISDIR"].includes(error.code)));
const handle = await fsp.open(at("lines.txt"), "w+");
await handle.writeFile("l1\nl2\nl3");
const lines = [];
for await (const line of (await fsp.open(at("lines.txt"))).readLines()) lines.push(line);
console.log(lines.join(), (await handle.stat()).size, typeof handle.fd);
await handle.close();
console.log(fs.readFileSync(at("lines.txt"), { encoding: "utf8", flag: "r" }).length, fs.lstatSync(at("lines.txt")).isSymbolicLink(), new fs.Stats() instanceof fs.Stats, typeof fs.Dirent, typeof fs.promises.constants.COPYFILE_EXCL);
fs.rmSync(folder, { recursive: true });
