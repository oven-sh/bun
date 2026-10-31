// What an executable cannot do as `bun run` does once `process.chdir(__dirname)` has put the working directory into the executable. The expected output is written down.
// The executable holds read-only data: whatever would change something under its root fails as on a read-only file system, by a relative path as by a whole one.
// The system has no such directory: a child starts in the system's own working directory, and there is nothing above the root.
// Flags: --asset ./data
const fs = require("node:fs");
const path = require("node:path");
const started = process.cwd();
// Under `bun run` the same calls would change this folder, so there the program works on a copy of it.
let root = __dirname;
if (Bun.embeddedFiles.length === 0) {
  root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "working-directory-"));
  fs.cpSync(path.join(__dirname, "data"), path.join(root, "data"), { recursive: true });
  process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
}
const show = (what, action) => {
  try {
    console.log(what + ":", action());
  } catch (error) {
    console.log(what + ": threw", error.code, error.syscall.replace(/^(posix|uv)_spawn$/, "spawn"));
  }
};
// Where a Windows machine has a `pwd`, it spells a path in a way of its own.
const printWorkingDirectory = process.platform === "win32" ? ["cmd", "/c", "cd"] : ["pwd"];
const workingDirectoryOfChild = options => Bun.spawnSync(printWorkingDirectory, options).stdout.toString().trim();
const rootOfSystem = path.parse(started).root;
process.chdir(root);
show("writeFileSync of a new file", () => fs.writeFileSync("data/new.txt", "x"));
show("writeFileSync over a file", () => fs.writeFileSync("data/note.txt", "x"));
show("writeFileSync in a folder that is not there", () => fs.writeFileSync("none/new.txt", "x"));
show("appendFileSync", () => fs.appendFileSync("data/note.txt", "x"));
show("openSync to write", () => fs.openSync("data/note.txt", "w"));
show("openSync to append", () => fs.openSync("data/log.txt", "a"));
show("mkdirSync", () => fs.mkdirSync("data/made"));
show("mkdirSync of what is there", () => fs.mkdirSync("data"));
show("mkdirSync recursive", () => fs.mkdirSync("data/a/b", { recursive: true }));
show("mkdirSync recursive of what is there", () => fs.mkdirSync("data", { recursive: true }));
show("mkdtempSync", () => fs.mkdtempSync("data/tmp-"));
show("unlinkSync", () => fs.unlinkSync("data/note.txt"));
show("unlinkSync of what is not there", () => fs.unlinkSync("data/none.txt"));
show("rmSync", () => fs.rmSync("data", { recursive: true }));
show("rmSync with force of what is not there", () => fs.rmSync("data/none.txt", { force: true }));
show("rmdirSync", () => fs.rmdirSync("data"));
show("renameSync", () => fs.renameSync("data/note.txt", "data/other.txt"));
show("copyFileSync into the executable", () => fs.copyFileSync("data/note.txt", "data/copy.txt"));
show("symlinkSync", () => fs.symlinkSync("note.txt", "data/link"));
show("truncateSync", () => fs.truncateSync("data/note.txt", 1));
show("chmodSync", () => fs.chmodSync("data/note.txt", 0o600));
show("utimesSync", () => fs.utimesSync("data/note.txt", 1, 1));
show("accessSync to write", () => fs.accessSync("data/note.txt", fs.constants.W_OK));
show("the file is as it was", () => fs.readFileSync("data/note.txt", "utf8").trim());
show("a child without cwd starts where the program was started", () => fs.realpathSync(workingDirectoryOfChild()) === fs.realpathSync(started));
show("a child with a cwd of the system starts there", () => workingDirectoryOfChild({ cwd: rootOfSystem }) === rootOfSystem);
show("a child with a cwd in the executable", () => workingDirectoryOfChild({ cwd: root }));
show("chdir above the root", () => process.chdir(".."));
show("cwd is as it was", () => process.cwd() === root);
(async () => {
  for (const [what, action] of [
    ["promises.writeFile", () => fs.promises.writeFile("data/new.txt", "x")],
    ["promises.mkdir recursive", () => fs.promises.mkdir("data/a/b", { recursive: true })],
    ["Bun.write", () => Bun.write("data/new.txt", "x")],
    ["Bun.write to a Bun.file", () => Bun.write(Bun.file("data/new.txt"), "x")],
    ["createWriteStream", () => new Promise((resolve, reject) => fs.createWriteStream("data/new.txt").on("error", reject).on("finish", resolve).end("x"))],
  ]) {
    try {
      console.log(what + ":", await action());
    } catch (error) {
      console.log(what + ": rejected", error.code, error.syscall);
    }
  }
})();
/* Output:
writeFileSync of a new file: threw EROFS open
writeFileSync over a file: threw EROFS open
writeFileSync in a folder that is not there: threw ENOENT open
appendFileSync: threw EROFS open
openSync to write: threw EROFS open
openSync to append: threw EROFS open
mkdirSync: threw EROFS mkdir
mkdirSync of what is there: threw EEXIST mkdir
mkdirSync recursive: threw EROFS mkdir
mkdirSync recursive of what is there: undefined
mkdtempSync: threw EROFS mkdtemp
unlinkSync: threw EROFS unlink
unlinkSync of what is not there: threw ENOENT unlink
rmSync: threw EROFS rm
rmSync with force of what is not there: undefined
rmdirSync: threw EROFS rmdir
renameSync: threw EROFS rename
copyFileSync into the executable: threw EROFS copyfile
symlinkSync: threw EROFS symlink
truncateSync: threw EROFS truncate
chmodSync: threw EROFS chmod
utimesSync: threw EROFS utime
accessSync to write: threw EACCES access
the file is as it was: a note
a child without cwd starts where the program was started: true
a child with a cwd of the system starts there: true
a child with a cwd in the executable: threw ENOENT spawn
chdir above the root: threw ENOENT chdir
cwd is as it was: true
promises.writeFile: rejected EROFS open
promises.mkdir recursive: rejected EROFS mkdir
Bun.write: rejected EROFS open
Bun.write to a Bun.file: rejected EROFS open
createWriteStream: rejected EROFS open
*/
