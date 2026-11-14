import fs from "node:fs";
const said = [];
function tell(label, s) {
  said.push(label + " own: " + Object.getOwnPropertyNames(s).sort().join());
  said.push([typeof s.dev, typeof s.ino, typeof s.mode, typeof s.nlink, typeof s.uid, typeof s.gid, typeof s.rdev, typeof s.size, typeof s.blksize, typeof s.blocks, typeof s.atimeMs, typeof s.mtimeMs, typeof s.ctimeMs, typeof s.birthtimeMs, typeof s.atime, typeof s.mtime, typeof s.ctime, typeof s.birthtime, typeof s.atimeNs, typeof s.mtimeNs, typeof s.ctimeNs, typeof s.birthtimeNs, typeof s.isFile, typeof s.isDirectory, s.isDirectory(), s.mtime instanceof Date].join());
}
tell("statSync", fs.statSync("."));
tell("lstatSync", fs.lstatSync("."));
const fd = fs.openSync(".", "r"); tell("fstatSync", fs.fstatSync(fd)); fs.closeSync(fd);
tell("bigint", fs.statSync(".", { bigint: true }));
tell("promises.stat", await fs.promises.stat("."));
tell("promises.lstat bigint", await fs.promises.lstat(".", { bigint: true }));
tell("callback", await new Promise((resolve) => fs.stat(".", (error, s) => resolve(s))));
said.push(String(fs.statSync("/nowhere-at-all", { throwIfNoEntry: false })));
const statfs = fs.statfsSync("."); said.push("statfs own: " + Object.getOwnPropertyNames(statfs).sort().join(), [typeof statfs.type, typeof statfs.bsize, typeof statfs.blocks, typeof statfs.bfree, typeof statfs.bavail, typeof statfs.files, typeof statfs.ffree].join());
console.log(said.join("\n"));
