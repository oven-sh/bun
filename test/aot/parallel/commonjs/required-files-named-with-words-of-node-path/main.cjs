// A file is required under a path made of the folder of the requiring file and what node:path gives: its separator, normalize(), the functions under `posix`.
const path = require("node:path");
const { sep, posix } = require("node:path");
const loads = {
  "the separator as a member": () => require(__dirname + path.sep + "first.cjs"),
  "the separator under a name": () => require(`${__dirname}${sep}second.cjs`),
  "normalize": () => require(path.normalize(__dirname + "/deeper/../third.cjs")),
  "join under posix": () => require(path.posix.join(__dirname, "fourth.cjs")),
  "posix under a name": () => require(posix.join(__dirname, "fifth.cjs")),
  "the module of posix": () => require(require("node:path/posix").resolve(__dirname, "sixth.cjs")),
};
for (const [name, load] of Object.entries(loads)) {
  try {
    console.log(name + ":", load());
  } catch (error) {
    console.log(name + ":", error.code);
  }
}
