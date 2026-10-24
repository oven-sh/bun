import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "modes-"));
const file = path.join(folder, "file.txt");
fs.writeFileSync(file, "content", { mode: 0o640 });
console.log((fs.statSync(file).mode & 0o777).toString(8), fs.statSync(file, { bigint: true }).size, fs.lstatSync(file).isSymbolicLink());
fs.chmodSync(file, 0o600);
fs.utimesSync(file, 1000, 2000);
console.log((fs.statSync(file).mode & 0o777).toString(8), fs.statSync(file).mtimeMs, fs.statSync(file).atime.toISOString());
fs.symlinkSync(file, path.join(folder, "link"));
fs.linkSync(file, path.join(folder, "hard"));
console.log(fs.readlinkSync(path.join(folder, "link")) === file, fs.lstatSync(path.join(folder, "link")).isSymbolicLink(), fs.realpathSync(path.join(folder, "link")) === fs.realpathSync(file), fs.statSync(file).nlink);
console.log(fs.statSync(path.join(folder, "nothing"), { throwIfNoEntry: false }), fs.accessSync(file, fs.constants.R_OK), fs.constants.O_RDONLY, typeof fs.constants.S_IFMT);

const handle = await fsp.open(file, "r+");
console.log((await handle.read(Buffer.alloc(4), 0, 4, 0)).bytesRead, (await handle.write("CON", 0)).bytesWritten, (await handle.stat()).size, await handle.readFile("utf8"), typeof handle.fd);
await handle.truncate(3);
await handle.sync();
await handle.close();
console.log(fs.readFileSync(file, "utf8"), await handle.stat().catch(error => error.code));
fs.writeFileSync(file, "l1\nl2\nl3");
const lines = [];
const reading = await fsp.open(file);
for await (const line of reading.readLines()) lines.push(line);
console.log(lines);

const directory = fs.opendirSync(folder);
const names = [];
for (let entry = directory.readSync(); entry; entry = directory.readSync()) names.push(entry.name + (entry.isFile() ? " file" : entry.isSymbolicLink() ? " link" : " other"));
directory.closeSync();
console.log(names.sort());
fs.cpSync(folder, folder + "-copy", { recursive: true, dereference: true });
console.log(fs.readdirSync(folder + "-copy").sort(), fs.globSync?.("*.txt", { cwd: folder }));

const changes = Promise.withResolvers();
const watcher = fs.watch(folder, (event, name) => changes.resolve(typeof event + " " + typeof name));
await Bun.sleep(20);
fs.writeFileSync(path.join(folder, "new.txt"), "x");
console.log(await changes.promise);
watcher.close();
await new Promise(resolve => fs.readFile(file, "utf8", (error, text) => resolve(console.log(error, text.length))));
await new Promise(resolve => fs.stat(path.join(folder, "missing"), error => resolve(console.log(error.code, error.message.startsWith("ENOENT")))));
await new Promise(resolve => fs.writeFile(file, Buffer.from("cb"), error => fs.appendFile(file, "!", () => fs.unlink(file, () => resolve(console.log(error, fs.existsSync(file)))))));
fs.rmSync(folder, { recursive: true });
fs.rmSync(folder + "-copy", { recursive: true });
try {
  fs.rmdirSync(folder);
} catch (error) {
  console.log(error.code, error.syscall);
}
