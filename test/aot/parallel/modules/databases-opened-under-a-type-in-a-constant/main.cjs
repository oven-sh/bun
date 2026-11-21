// Reference: bun build --compile
// A type that a constant holds opens a database as a written type does: the one in the working directory.
const { Database } = require("bun:sqlite");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const kind = "sqlite";
const folder = mkdtempSync(join(tmpdir(), "databases-"));
for (const name of ["shelf.data", "cellar.data"]) {
  const made = new Database(join(folder, name));
  made.run(`create table ${name.slice(0, -5)} (item)`);
  made.close();
}
process.chdir(folder);
const read = load => {
  try {
    const { db } = load();
    const names = db.query("select name from sqlite_master").all().map(row => row.name);
    db.close();
    return names.join();
  } catch (error) {
    return error.code ?? error.name;
  }
};
console.log(read(() => require("./shelf.data", { type: kind })), read(() => require("./cellar.data", { type: kind })));
process.chdir("/");
rmSync(folder, { recursive: true });
