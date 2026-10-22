// What fs-extra, graceful-fs and universalify do: walk over the members of node:fs, copy or wrap each into an object of their own, and hand that out. The program then calls the copies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import util from "node:util";

const byKeys = {};
for (const key of Object.keys(fs)) byKeys[key] = fs[key];
const byDescriptors = Object.create(Object.getPrototypeOf(fs), Object.getOwnPropertyDescriptors(fs));
const bySpread = { ...fs };
const promisified = {};
for (const key of Object.keys(fs)) {
  if (typeof fs[key] === "function" && !key.endsWith("Sync") && !/^[A-Z_]|^create|^watch|^unwatch|^exists$|^openAsBlob$|^glob$/.test(key)) promisified[key] = util.promisify(fs[key]);
}

const folder = byKeys.mkdtempSync(path.join(os.tmpdir(), "library-modules-"));
const file = path.join(folder, "a.txt");
byDescriptors.writeFileSync(file, "copied functions");
console.log(bySpread.readFileSync(file, "utf8"), byKeys.statSync(file).size, byDescriptors.existsSync(file));
await promisified.appendFile(file, " still work");
console.log(await promisified.readFile(file, "utf8"), (await promisified.stat(file)).isFile(), (await promisified.readdir(folder)).join(), await promisified.access(path.join(folder, "none")).catch(error => error.code));
await promisified.rm(folder, { recursive: true });
console.log(bySpread.existsSync(folder), Object.keys(byKeys).length === Object.keys(fs).length, typeof byKeys.promises.readFile, byKeys.constants === fs.constants);
