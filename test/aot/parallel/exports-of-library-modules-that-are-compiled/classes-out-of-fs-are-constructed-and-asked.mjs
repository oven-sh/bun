import fs, { Stats, Dirent, statSync, readdirSync } from "node:fs";
const stats = statSync(import.meta.dir);
console.log(stats instanceof Stats, stats.isDirectory(), stats.constructor === Stats, typeof stats.mtime.getTime(), Object.prototype.toString.call(stats.mtime));
const entries = readdirSync(import.meta.dir, { withFileTypes: true });
console.log(entries.length > 0, entries[0] instanceof Dirent, typeof entries[0].name, entries[0].isFile() || entries[0].isDirectory());
console.log(typeof fs.constants.F_OK, fs.F_OK === fs.constants.F_OK);
