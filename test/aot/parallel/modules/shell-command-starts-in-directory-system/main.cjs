// After `process.chdir()` into a folder that only the executable holds, a `Bun.$` command starts in the directory that the system knows, as a child process does, and reads files from disk
// only; `.cwd()` with a folder on disk moves it. The folder `data` is embedded with --asset.
// Flags: --asset ./data
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shell-")));
fs.mkdirSync(path.join(scratch, "data"));
fs.writeFileSync(path.join(scratch, "data", "note.txt"), "a note on disk\n");
const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shell-")));
const clean = text => text.trim().replaceAll(scratch, "<scratch>").replaceAll(other, "<other>").replaceAll(__dirname, "<root>");
const run = command => command.quiet().text().then(clean, error => "failed: " + (error.exitCode ?? error.code));
(async () => {
  process.chdir(scratch);
  process.chdir(__dirname);
  console.log("process.cwd():", clean(process.cwd()));
  console.log("readFileSync:", fs.readFileSync("data/note.txt", "utf8").trim());
  console.log("pwd:", await run(Bun.$`pwd`));
  console.log("cat of a relative path:", await run(Bun.$`cat data/note.txt`));
  console.log("cat of an embedded file:", await run(Bun.$`cat ${path.join(__dirname, "data", "note.txt")}`));
  console.log("pwd with cwd:", await run(Bun.$`pwd`.cwd(other)));
  console.log("cwd in the executable:", await run(Bun.$`pwd`.cwd(__dirname)));
  process.chdir(os.tmpdir());
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
})();
/* Output:
process.cwd(): <root>
readFileSync: a note
pwd: <scratch>
cat of a relative path: a note on disk
cat of an embedded file: failed: 1
pwd with cwd: <other>
cwd in the executable: failed: ENOENT
*/
