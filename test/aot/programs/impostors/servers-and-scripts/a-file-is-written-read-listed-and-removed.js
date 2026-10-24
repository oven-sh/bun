import fs from "node:fs";
import { mkdtemp, readFile, writeFile, appendFile, readdir, stat, rename, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const folder = await mkdtemp(path.join(os.tmpdir(), "notes-"));
const first = path.join(folder, "first.txt");
await writeFile(first, "line one\n");
await appendFile(first, "line two\n", "utf8");
console.log(JSON.stringify(await readFile(first, "utf8")), (await readFile(first)).length);
const info = await stat(first);
console.log(info.isFile(), info.isDirectory(), info.size, info.mtime instanceof Date, typeof info.mtimeMs);

fs.mkdirSync(path.join(folder, "deep", "deeper"), { recursive: true });
fs.writeFileSync(path.join(folder, "deep", "data.json"), JSON.stringify({ a: [1, 2], b: null }));
console.log(JSON.parse(fs.readFileSync(path.join(folder, "deep", "data.json"), "utf8")));
console.log((await readdir(folder)).sort(), fs.readdirSync(folder, { withFileTypes: true }).map(entry => entry.name + ":" + entry.isDirectory()).sort());
console.log(fs.readdirSync(folder, { recursive: true }).sort());

await rename(first, path.join(folder, "renamed.txt"));
console.log(fs.existsSync(first), fs.existsSync(path.join(folder, "renamed.txt")));
try {
  await access(first);
} catch (error) {
  console.log(error.code, error.syscall, error instanceof Error);
}
try {
  fs.readFileSync(path.join(folder, "missing.txt"));
} catch (error) {
  console.log(error.code, error.errno < 0, error.path === path.join(folder, "missing.txt"));
}
const descriptor = fs.openSync(path.join(folder, "renamed.txt"), "r");
const bytes = Buffer.alloc(8);
console.log(fs.readSync(descriptor, bytes, 0, 8, 5), bytes.toString());
fs.closeSync(descriptor);
fs.copyFileSync(path.join(folder, "renamed.txt"), path.join(folder, "copy.txt"));
fs.truncateSync(path.join(folder, "copy.txt"), 4);
console.log(fs.readFileSync(path.join(folder, "copy.txt"), "latin1"), fs.statSync(path.join(folder, "copy.txt")).size);
await rm(folder, { recursive: true, force: true });
console.log(fs.existsSync(folder));
